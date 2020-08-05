import * as core from '@actions/core';
import { StatusCodes, WebRequest, WebResponse, sendRequest } from "./client";
import { getAADToken } from './AzCLIAADTokenGenerator';
import * as fs from 'fs';
import * as fileHelper from './fileHelper';
import * as table from 'table';
import {dirname} from 'path'
import * as exec from '@actions/exec';


const KEY_RESOURCE_ID = "resourceId";
const KEY_POLICY_ASSG_ID = "policyAssignmentId";
const KEY_RESOURCE_TYPE = "resourceType";
const KEY_RESOURCE_LOCATION = "resourceLocation";
const KEY_IS_COMPLIANT = "isCompliant";
const TITLE_RESOURCE_ID = "RESOURCE_ID";
const TITLE_POLICY_ASSG_ID = "POLICY_ASSG_ID";
const TITLE_RESOURCE_TYPE = "RESOURCE_TYPE";
const TITLE_RESOURCE_LOCATION = "RESOURCE_LOCATION";
const TITLE_IS_COMPLIANT = "IS_COMPLIANT";
const CSV_FILENAME = 'ScanReport.csv';
const JSON_FILENAME = 'scanReport.json';

function printPartitionedText(text) {
  const textPartition: string = '----------------------------------------------------------------------------------------------------';
  console.log(`${textPartition}\n${text}\n${textPartition}`);
}

async function triggerScan(scope: string, token: string): Promise<string> {
  let triggerScanUrl = `https://management.azure.com${scope}/providers/Microsoft.PolicyInsights/policyStates/latest/triggerEvaluation?api-version=2019-10-01`;

  let webRequest = new WebRequest();
  webRequest.method = 'POST';
  webRequest.uri = triggerScanUrl;
  webRequest.headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json; charset=utf-8'
  }

  printPartitionedText(`Triggering scan. URL: ${triggerScanUrl}`);
  return sendRequest(webRequest).then((response: WebResponse) => {
    console.log('Response status code: ', response.statusCode);
    if (response.headers['location']) {
      let pollLocation = response.headers['location'];
      console.log('Successfully triggered scan. Poll location: ', pollLocation)
      return Promise.resolve(pollLocation);
    } else {
      return Promise.reject(`Location header missing in response.\nResponse body: ${JSON.stringify(response.body)}`);
    }
  }).catch(error => {
    console.log('An error occured while triggering the scan. Error: ', error);
    return Promise.reject(error);
  });
}

async function isScanCompleted(pollUrl: string, token: string): Promise<boolean> {
  let webRequest = new WebRequest();
  webRequest.method = 'GET';
  webRequest.uri = pollUrl;
  webRequest.headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json; charset=utf-8'
  }

  console.log(`Polling for scan status. URL: ${pollUrl}`);
  return sendRequest(webRequest).then((response: WebResponse) => {
    console.log(`Response status code: ${response.statusCode}\n`);
    if (response.statusCode == StatusCodes.OK) {
      return Promise.resolve(true);
    } else if (response.statusCode == StatusCodes.ACCEPTED) {
      return Promise.resolve(false);
    } else {
      return Promise.reject(`An error occured while polling the scan status. Poll url: ${pollUrl}, StatusCode: ${response.statusCode}, Body: ${JSON.stringify(response.body)}`);
    }
  }).catch(error => {
    console.log(error);
    return Promise.reject(error);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pollForCompletion(pollLocations: any[], token: string) {
  printPartitionedText('Starting to poll for scan statuses. Poll urls:');
  pollLocations.forEach(location => {
    console.log(location.pollLocation);
  });

  let pendingPolls: any[] = pollLocations;
  
  let pollRound: number = 1;
  let hasPollTimedout: boolean = false;
  const pollTimeoutDuration: number = parseInt(core.getInput('poll-Timeout'));
  // Setting poll timeout
  let pollTimeoutId = setTimeout(() => { hasPollTimedout = true; }, pollTimeoutDuration * 60 * 1000);
  const pollInterval: number = 60 * 1000; // 60000ms = 1min
  try {
    while (pendingPolls.length > 0 && !hasPollTimedout) {
      printPartitionedText(`Poll round: ${pollRound}, No. of pending polls: ${pendingPolls.length}`);
      let pendingPollsNew: any[] = [];
      let completedPolls: any[] = [];
      for (const poll of pendingPolls) {
        const isCompleted = await isScanCompleted(poll.pollLocation, token);
        if (isCompleted) {
          completedPolls.push(poll);
        }
        else {
          pendingPollsNew.push(poll);
        }
      }

      pendingPolls = pendingPollsNew;

      let startTime : Date = new Date();
      await getScanResult(completedPolls,token); 
      let endTime : Date = new Date();
      let remainingTime = pollInterval - (endTime.getTime() - startTime.getTime());
      //If time remains after storing success results then wait for it till the pollinterval is over
      if(remainingTime > 0){
        await sleep(remainingTime);
      }
      pollRound++;
    }
    if (hasPollTimedout && pendingPolls.length > 0) {
      printPartitionedText('Polling status timedout.');
    }
  }
  catch (error) {
    console.log(`An error has occured while polling the status of compliance scans. Error: ${error}.\nPending polls:`);
    pendingPolls.forEach(pendingPoll => {
      console.log(pendingPoll);
    });
  }

  if (!hasPollTimedout) {
    clearTimeout(pollTimeoutId);
  }
}

async function getAccessToken(): Promise<string> {
  let accessToken = '';
  let expiresOn = '';
  await getAADToken().then(token => {
    const tokenObject = JSON.parse(token);
    accessToken = tokenObject.accessToken;
    expiresOn = tokenObject.expiresOn;
  });
  return accessToken;
}

async function getScanResultForScope(scope: string, token: string): Promise<any[]> {

  let selectQuery = '$select=resourceId,policyAssignmentId,resourceType,resourceLocation,isCompliant';
  let scanResultUrl = `https://management.azure.com${scope}/providers/Microsoft.PolicyInsights/policyStates/latest/queryResults?api-version=2019-10-01&${selectQuery}`;

  let webRequest = new WebRequest();
  webRequest.method = 'POST';
  webRequest.uri = scanResultUrl;
  webRequest.headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json; charset=utf-8'
  }

  console.log('Getting scan result. URL: ', scanResultUrl);
  return sendRequest(webRequest).then((response: WebResponse) => {
    console.log('Response status code: ', response.statusCode);
    if (response.statusCode == 200){
      console.log(`Received scan result for Scope: ${scope}`);
      return Promise.resolve(response.body.value);
    }
    else{
      return Promise.reject(`An error occured while fetching the scan result. StatusCode: ${response.statusCode}, Body: ${JSON.stringify(response.body)}`);
    }
  }).catch(error => {
  return Promise.reject(error);
  });

}

async function getScanResult(polls: any[], token: string) {
  let scanResults : any[] = [];
  for (const poll of polls) {
    await getScanResultForScope(poll.scope, token).then((resultsArray) => {      
      scanResults.push(...resultsArray.filter(result =>{return result.isCompliant == false}));
    }).catch(error => {
      throw Error(error);
    });
    //Writing to file non-compliant records from every successful poll, for every poll-round
    try {
      if(scanResults.length > 0){
        const scanReportPath = `${fileHelper.getPolicyScanDirectory()}/${JSON_FILENAME}`;
        fs.appendFileSync(scanReportPath, JSON.stringify(scanResults, null, 2));
      }
    }
    catch (error) {
      console.log(`An error has occured while recording of compliance scans to file. Error: ${error}.`);
    }
  }
}

function getConfigForTable(widths: number[]): any {
  let config = {
    columns: {
      0: {
        width: widths[0],
        wrapWord: true
      },
      1: {
        width: widths[1],
        wrapWord: true
      },
      2: {
        width: widths[2],
        wrapWord: true
      },
      3: {
        width: widths[3],
        wrapWord: true
      },
      4: {
        width: widths[4],
        wrapWord: true
      },
      5: {
        width: widths[5],
        wrapWord: true
      } 
    }
  };

  return config;
}

 function printFormattedOutput(data : any[]): any[] {
  let rows : any = [];
  let titles = [TITLE_RESOURCE_ID, TITLE_POLICY_ASSG_ID, TITLE_RESOURCE_TYPE, TITLE_RESOURCE_LOCATION, TITLE_IS_COMPLIANT];
  try{ 
    rows.push(titles);

    data.forEach((cve: any) => {
        let row : any = [];
        row.push(cve[KEY_RESOURCE_ID]);
        row.push(cve[KEY_POLICY_ASSG_ID]);
        row.push(cve[KEY_RESOURCE_TYPE]);
        row.push(cve[KEY_RESOURCE_LOCATION]);
        row.push(cve[KEY_IS_COMPLIANT]);
        rows.push(row);
    });

    let widths = [25, 25, 25, 20, 20];
    console.log(table.table(rows, getConfigForTable(widths)));
  }
  catch (error) {
    console.log(`An error has occured while parsing results to console output table : ${error}.`);
  }
  return rows;
}

async function createCSV(data : any[]){
  try{
    let fileName = CSV_FILENAME;
    let filePath = fileHelper.writeToCSVFile(data, fileName);
    await fileHelper.uploadFile(
      fileName,
      filePath,
      dirname(filePath)
    );
  }
  catch (error) {
    console.log(`An error has occured while writing to csv file : ${error}.`);
  }

}

async function getPolicyFromAzure(id: string) {

  let triggerScanUrl = `https://management.azure.com${id}?api-version=2019-09-01`;

  const token = await getAccessToken();

  let webRequest = new WebRequest();
  webRequest.method = 'GET';
  webRequest.uri = triggerScanUrl;
  webRequest.headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json; charset=utf-8'
  }

  printPartitionedText(`Gettings policy. URL: ${triggerScanUrl}`);


  return sendRequest(webRequest).then((response: WebResponse) => {
    console.log('Response status code: ', response.statusCode);
    if (response.statusCode == StatusCodes.OK) {
      // If scan is done, return empty poll url
      return Promise.resolve(response);
    }
    else {
      return Promise.reject(
        `An error occured while fetching the batch result. StatusCode: ${
          response.statusCode
        }, Body: ${JSON.stringify(response.body)}`
      );
    }
  }).catch(error => {
    console.log('An error occured while getting policy id', error);
    return Promise.reject(error);
  });

}

async function run() {

  console.log("started");

  let list = require('child_process').execSync('ls').toString().trim();
  console.log("list : " + list);

  let hash = require('child_process').execSync('git hash-object action.yml').toString().trim();
  console.log("hash : " + hash);

  console.log("tried");
  // try {
  //   const filePath = core.getInput('scopes');

  //   const policyJson = fileHelper.getFileJson(filePath);
  //   const policyId = policyJson['id'];

  //   let policy = await getPolicyFromAzure(policyId);

  //   console.log(JSON.stringify(policy.body))




  //   console.log("Action Ran")

  // } catch (error) {
  //   core.setFailed(error.message);
  // }



  // try {
  //   const scopesInput = core.getInput('scopes');
  //   const token = await getAccessToken();//core.getInput('bearer-token');
  //   const scopes = scopesInput ? scopesInput.split('\n') : [];

  //   let resultMap = new Map();

  //   let pollLocations: any[] = [];
  //   for (const scope of scopes) {
  //     const pollLocation = await triggerScan(scope, token).catch(error => {
  //       throw Error(error);
  //     });

  //     pollLocations.push({
  //       'scope' : scope,
  //       'pollLocation' : pollLocation 
  //     });
  //   }

  //   //Creating intermediate file to store success records
  //   const scanReportPath = `${fileHelper.getPolicyScanDirectory()}/${JSON_FILENAME}`;
  //   fs.writeFileSync(scanReportPath, "");
  //   //Polls and records successful non-compliant responses
  //   await pollForCompletion(pollLocations, token).catch(error => {
  //     throw Error(error);
  //   });

  //   //Fetch all successful non-compliant responses
  //   const out = fileHelper.getFileJson(scanReportPath);
  //   if(out != null){

  //     //Console print and csv publish
  //     console.log('Policy compliance scan report::\n');
  //     let csv_object = printFormattedOutput(out);
  //     await createCSV(csv_object);

  //     throw Error("1 or more resources were non-compliant");
  //   }
  //   else{
  //     console.log('All resources are compliant');
  //   }
     
  // } catch (error) {
  //   core.setFailed(error.message);
  // }
}

run();