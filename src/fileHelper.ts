import * as fs from 'fs';
import * as path from 'path';
import * as core from '@actions/core';
import * as os from 'os';
import {create, UploadOptions} from '@actions/artifact';
import {dirname} from 'path'

let POLICY_SCAN_DIRECTORY = '';

export function getFileJson(path: string): any {
    try {
        const rawContent = fs.readFileSync(path, 'utf8');
        if(rawContent != null && rawContent.length > 0)
          return JSON.parse(rawContent);
        return null;
    } catch (ex) {
        throw new Error(`An error occured while reading the contents of the file: ${path}. Error: ${ex}`);
    }
}
