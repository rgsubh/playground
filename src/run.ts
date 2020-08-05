import * as core from '@actions/core';
import { StatusCodes, WebRequest, WebResponse, sendRequest } from "./client";
import { getAADToken } from './AzCLIAADTokenGenerator';
import * as fileHelper from './fileHelper';

function printPartitionedText(text) {
  const textPartition: string = '----------------------------------------------------------------------------------------------------';
  console.log(`${textPartition}\n${text}\n${textPartition}`);
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


function getGitFileHash(filePath: string): string {
  return require('child_process').execSync(`git hash-object ${filePath}`).toString().trim();
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
  try {
    const filePath = core.getInput('scopes');

    const policyJson = fileHelper.getFileJson(filePath);
    const policyId = policyJson['id'];

    let policyResponse = await getPolicyFromAzure(policyId);

    console.log(JSON.stringify(policyResponse.body))

    const fileHash = getGitFileHash(filePath);

    console.log("FileHash : " + fileHash);


    let policyDef = policyResponse.body;
    let metadata = policyDef['properties']['metadata'];

    console.log("metaData : " + JSON.stringify(metadata));


    if (metadata['github-policy']) {
      console.log("Github metaData is present.");
      let azureHash: string = metadata['github-policy']['policy_hash'];

      if (fileHash == azureHash) {
        console.log("Hash is same no need to update");
      }
      else {
        console.log("Hash is different. Need to update");
      }

    }
    else {
      console.log("Github metaData is not present. Will need to update the policy definition");
    }

    console.log("Action Ran")

  } catch (error) {
    core.setFailed(error.message);
  }
}

run();