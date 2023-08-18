import * as path from 'path';

import { TaskMockRunner } from 'azure-pipelines-task-lib/mock-run';
import { TaskLibAnswers } from 'azure-pipelines-task-lib/mock-answer';

import { getTempDir, initializeTest, MavenTaskInputs, setInputs } from './TestUtils';
import { BuildOutput } from 'azure-pipelines-tasks-codeanalysis-common/Common/BuildOutput';
const taskPath = path.join(__dirname, '..', 'maventask.js');

const tmr = new TaskMockRunner(taskPath);

// Set Inputs
const inputs: MavenTaskInputs = {
    mavenVersionSelection: 'Default',
    mavenPOMFile: 'pom.xml',
    options: '',
    goals: 'package',
    javaHomeSelection: 'JDKVersion',
    jdkVersion: 'default',
    publishJUnitResults: false,
    testResultsFiles: '**/TEST-*.xml',
    mavenOpts: '-Xmx2048m',
    checkstyleAnalysisEnabled: false,
    pmdAnalysisEnabled: false,
    findbugsAnalysisEnabled: false,
    spotBugsAnalysisEnabled: true,
    spotBugsGoal: 'spotbugs',
    spotBugsMavenPluginVersion: '4.5.3.0',
    mavenFeedAuthenticate: false,
    restoreOriginalPomXml: false
};
setInputs(tmr, inputs);

const mavenHome = '/home/';
const mavenBin = path.join(mavenHome, 'bin', 'mvn');

// Set up environment variables (task-lib does not support mocking getVariable)
// Env vars in the mock framework must replace '.' with '_'
delete process.env.M2_HOME; // Remove in case process running this test has it already set

// Common initial setup
initializeTest(tmr);

// Provide answers for task mock
const answers: TaskLibAnswers = {
    which: {
        mvn: mavenBin
    },
    checkPath: {
        [`${mavenBin}`]: true,
        'pom.xml': true
    },
    exist: {
        mavenPOMFile: true,
        [path.join(getTempDir(), '.mavenInfo')]: true
    },
    exec: {
        [`${mavenBin} -version`]: {
            code: 0,
            stdout: 'Maven version 1.0.0'
        },
        [`${mavenBin} -f pom.xml clean package`]: {
            code: 0,
            stdout: 'Maven package done'
        },
        [`${mavenBin} -f pom.xml package`]: {
            code: 0,
            stdout: 'Maven package done'
        },
        [`${mavenBin} -f pom.xml package spotbugs:spotbugs`]: {
            code: 0,
            stdout: 'Spotbugs check done'
        }
    },
    findMatch: {
        '**/TEST-*.xml': [
            '/user/build/fun/test-123.xml'
        ]
    }
};
tmr.setAnswers(answers);

const mockPomFile = `
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.mycompany.app</groupId>
  <artifactId>my-app</artifactId>
  <version>1</version>
  <build>
    <plugins></plugins>
  </build>
</project>
`;

const fileUtilsMock = {
    readFile: function (filePath: string, encoding?: string): Promise<string> {
        console.log('Reading pom.xml file');
        return new Promise((resolve) => {
            resolve(mockPomFile);
        });
    },
    writeFile: function (filePath: string, fileContent: string, encoding?: string): void {
        console.log(`Modified content: \n ${fileContent}`);
        console.log('Writing modified pom.xml');
    },
    copyFile: function (sourcePath: string, destinationPath: string): void {
        console.log('Copying the file to destinarion');
    }
};

let fu = require('../utils/fileUtils');
tmr.registerMock(fu, fileUtilsMock);

const spotbugsPublishMock = {
    PublishSpotbugsReport: function (mavenPOMFile: string, buildOutput: BuildOutput): void {
        console.log('Publishing the spotbugs analysis results');
    }
};

let sp = require('../spotbugsTool/publishSpotbugsReport');
tmr.registerMock(sp, spotbugsPublishMock);

// Run task
tmr.run();
