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
const fileHelper = __importStar(require("./fileHelper"));
function printPartitionedText(text) {
    const textPartition = '----------------------------------------------------------------------------------------------------';
    console.log(`${textPartition}\n${text}\n${textPartition}`);
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
function getGitFileHash(filePath) {
    return require('child_process').execSync(`git hash-object ${filePath}`).toString().trim();
}
function getPolicyFromAzure(id) {
    return __awaiter(this, void 0, void 0, function* () {
        let triggerScanUrl = `https://management.azure.com${id}?api-version=2019-09-01`;
        const token = yield getAccessToken();
        let webRequest = new client_1.WebRequest();
        webRequest.method = 'GET';
        webRequest.uri = triggerScanUrl;
        webRequest.headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json; charset=utf-8'
        };
        printPartitionedText(`Gettings policy. URL: ${triggerScanUrl}`);
        return client_1.sendRequest(webRequest).then((response) => {
            console.log('Response status code: ', response.statusCode);
            if (response.statusCode == client_1.StatusCodes.OK) {
                // If scan is done, return empty poll url
                return Promise.resolve(response);
            }
            else {
                return Promise.reject(`An error occured while fetching the batch result. StatusCode: ${response.statusCode}, Body: ${JSON.stringify(response.body)}`);
            }
        }).catch(error => {
            console.log('An error occured while getting policy id', error);
            return Promise.reject(error);
        });
    });
}
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const filePath = core.getInput('scopes');
            const policyJson = fileHelper.getFileJson(filePath);
            const policyId = policyJson['id'];
            let policyResponse = yield getPolicyFromAzure(policyId);
            console.log(JSON.stringify(policyResponse.body));
            const fileHash = getGitFileHash(filePath);
            console.log("FileHash : " + fileHash);
            let policyDef = policyResponse.body;
            let metadata = policyDef['properties']['metadata'];
            console.log("metaData : " + JSON.stringify(metadata));
            if (metadata['github-policy']) {
                console.log("Github metaData is present.");
                let azureHash = metadata['github-policy']['policy_hash'];
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
            console.log("Action Ran");
        }
        catch (error) {
            core.setFailed(error.message);
        }
    });
}
run();
