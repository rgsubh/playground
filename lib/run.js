"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const client_1 = require("./client");
const AzCLIAADTokenGenerator_1 = require("./AzCLIAADTokenGenerator");
const fs = __importStar(require("fs"));
const fileHelper = __importStar(require("./fileHelper"));
const table = __importStar(require("table"));
const path_1 = require("path");
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
    const textPartition = '----------------------------------------------------------------------------------------------------';
    console.log(`${textPartition}\n${text}\n${textPartition}`);
}
function triggerScan(scope, token) {
    return __awaiter(this, void 0, void 0, function* () {
        let triggerScanUrl = `https://management.azure.com${scope}/providers/Microsoft.PolicyInsights/policyStates/latest/triggerEvaluation?api-version=2019-10-01`;
        let webRequest = new client_1.WebRequest();
        webRequest.method = 'POST';
        webRequest.uri = triggerScanUrl;
        webRequest.headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json; charset=utf-8'
        };
        printPartitionedText(`Triggering scan. URL: ${triggerScanUrl}`);
        return client_1.sendRequest(webRequest).then((response) => {
            console.log('Response status code: ', response.statusCode);
            if (response.headers['location']) {
                let pollLocation = response.headers['location'];
                console.log('Successfully triggered scan. Poll location: ', pollLocation);
                return Promise.resolve(pollLocation);
            }
            else {
                return Promise.reject(`Location header missing in response.\nResponse body: ${JSON.stringify(response.body)}`);
            }
        }).catch(error => {
            console.log('An error occured while triggering the scan. Error: ', error);
            return Promise.reject(error);
        });
    });
}
function isScanCompleted(pollUrl, token) {
    return __awaiter(this, void 0, void 0, function* () {
        let webRequest = new client_1.WebRequest();
        webRequest.method = 'GET';
        webRequest.uri = pollUrl;
        webRequest.headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json; charset=utf-8'
        };
        console.log(`Polling for scan status. URL: ${pollUrl}`);
        return client_1.sendRequest(webRequest).then((response) => {
            console.log(`Response status code: ${response.statusCode}\n`);
            if (response.statusCode == client_1.StatusCodes.OK) {
                return Promise.resolve(true);
            }
            else if (response.statusCode == client_1.StatusCodes.ACCEPTED) {
                return Promise.resolve(false);
            }
            else {
                return Promise.reject(`An error occured while polling the scan status. Poll url: ${pollUrl}, StatusCode: ${response.statusCode}, Body: ${JSON.stringify(response.body)}`);
            }
        }).catch(error => {
            console.log(error);
            return Promise.reject(error);
        });
    });
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function pollForCompletion(pollLocations, token) {
    return __awaiter(this, void 0, void 0, function* () {
        printPartitionedText('Starting to poll for scan statuses. Poll urls:');
        pollLocations.forEach(location => {
            console.log(location.pollLocation);
        });
        let pendingPolls = pollLocations;
        let pollRound = 1;
        let hasPollTimedout = false;
        const pollTimeoutDuration = parseInt(core.getInput('poll-Timeout'));
        // Setting poll timeout
        let pollTimeoutId = setTimeout(() => { hasPollTimedout = true; }, pollTimeoutDuration * 60 * 1000);
        const pollInterval = 60 * 1000; // 60000ms = 1min
        try {
            while (pendingPolls.length > 0 && !hasPollTimedout) {
                printPartitionedText(`Poll round: ${pollRound}, No. of pending polls: ${pendingPolls.length}`);
                let pendingPollsNew = [];
                let completedPolls = [];
                for (const poll of pendingPolls) {
                    const isCompleted = yield isScanCompleted(poll.pollLocation, token);
                    if (isCompleted) {
                        completedPolls.push(poll);
                    }
                    else {
                        pendingPollsNew.push(poll);
                    }
                }
                pendingPolls = pendingPollsNew;
                let startTime = new Date();
                yield getScanResult(completedPolls, token);
                let endTime = new Date();
                let remainingTime = pollInterval - (endTime.getTime() - startTime.getTime());
                //If time remains after storing success results then wait for it till the pollinterval is over
                if (remainingTime > 0) {
                    yield sleep(remainingTime);
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
    });
}
function getAccessToken() {
    return __awaiter(this, void 0, void 0, function* () {
        let accessToken = '';
        let expiresOn = '';
        yield AzCLIAADTokenGenerator_1.getAADToken().then(token => {
            const tokenObject = JSON.parse(token);
            accessToken = tokenObject.accessToken;
            expiresOn = tokenObject.expiresOn;
        });
        return accessToken;
    });
}
function getScanResultForScope(scope, token) {
    return __awaiter(this, void 0, void 0, function* () {
        let selectQuery = '$select=resourceId,policyAssignmentId,resourceType,resourceLocation,isCompliant';
        let scanResultUrl = `https://management.azure.com${scope}/providers/Microsoft.PolicyInsights/policyStates/latest/queryResults?api-version=2019-10-01&${selectQuery}`;
        let webRequest = new client_1.WebRequest();
        webRequest.method = 'POST';
        webRequest.uri = scanResultUrl;
        webRequest.headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json; charset=utf-8'
        };
        console.log('Getting scan result. URL: ', scanResultUrl);
        return client_1.sendRequest(webRequest).then((response) => {
            console.log('Response status code: ', response.statusCode);
            if (response.statusCode == 200) {
                console.log(`Received scan result for Scope: ${scope}`);
                return Promise.resolve(response.body.value);
            }
            else {
                return Promise.reject(`An error occured while fetching the scan result. StatusCode: ${response.statusCode}, Body: ${JSON.stringify(response.body)}`);
            }
        }).catch(error => {
            return Promise.reject(error);
        });
    });
}
function getScanResult(polls, token) {
    return __awaiter(this, void 0, void 0, function* () {
        let scanResults = [];
        for (const poll of polls) {
            yield getScanResultForScope(poll.scope, token).then((resultsArray) => {
                scanResults.push(...resultsArray.filter(result => { return result.isCompliant == false; }));
            }).catch(error => {
                throw Error(error);
            });
            //Writing to file non-compliant records from every successful poll, for every poll-round
            try {
                if (scanResults.length > 0) {
                    const scanReportPath = `${fileHelper.getPolicyScanDirectory()}/${JSON_FILENAME}`;
                    fs.appendFileSync(scanReportPath, JSON.stringify(scanResults, null, 2));
                }
            }
            catch (error) {
                console.log(`An error has occured while recording of compliance scans to file. Error: ${error}.`);
            }
        }
    });
}
function getConfigForTable(widths) {
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
function printFormattedOutput(data) {
    let rows = [];
    let titles = [TITLE_RESOURCE_ID, TITLE_POLICY_ASSG_ID, TITLE_RESOURCE_TYPE, TITLE_RESOURCE_LOCATION, TITLE_IS_COMPLIANT];
    try {
        rows.push(titles);
        data.forEach((cve) => {
            let row = [];
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
function createCSV(data) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            let fileName = CSV_FILENAME;
            let filePath = fileHelper.writeToCSVFile(data, fileName);
            yield fileHelper.uploadFile(fileName, filePath, path_1.dirname(filePath));
        }
        catch (error) {
            console.log(`An error has occured while writing to csv file : ${error}.`);
        }
    });
}
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const scopesInput = core.getInput('scopes');
            const token = yield getAccessToken(); //core.getInput('bearer-token');
            const scopes = scopesInput ? scopesInput.split('\n') : [];
            let resultMap = new Map();
            let pollLocations = [];
            for (const scope of scopes) {
                const pollLocation = yield triggerScan(scope, token).catch(error => {
                    throw Error(error);
                });
                pollLocations.push({
                    'scope': scope,
                    'pollLocation': pollLocation
                });
            }
            //Creating intermediate file to store success records
            const scanReportPath = `${fileHelper.getPolicyScanDirectory()}/${JSON_FILENAME}`;
            fs.writeFileSync(scanReportPath, "");
            //Polls and records successful non-compliant responses
            yield pollForCompletion(pollLocations, token).catch(error => {
                throw Error(error);
            });
            //Fetch all successful non-compliant responses
            const out = fileHelper.getFileJson(scanReportPath);
            if (out != null) {
                //Console print and csv publish
                console.log('Policy compliance scan report::\n');
                let csv_object = printFormattedOutput(out);
                yield createCSV(csv_object);
                throw Error("1 or more resources were non-compliant");
            }
            else {
                console.log('All resources are compliant');
            }
        }
        catch (error) {
            core.setFailed(error.message);
        }
    });
}
run();
