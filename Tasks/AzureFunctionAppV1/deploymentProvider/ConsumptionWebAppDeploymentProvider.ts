import { AzureRmWebAppDeploymentProvider } from './AzureRmWebAppDeploymentProvider';
import tl = require('vsts-task-lib/task');
import { AzureAppService } from 'azurermdeploycommon/azure-arm-rest/azure-arm-app-service';
import { AzureAppServiceUtility } from 'azurermdeploycommon/operations/AzureAppServiceUtility';
import { PackageType } from 'azurermdeploycommon/webdeployment-common/packageUtility';
import { sleepFor } from 'azurermdeploycommon/azure-arm-rest/webClient';
import Q = require('q');
var webCommonUtility = require('azurermdeploycommon/webdeployment-common/utility.js');
var zipUtility = require('azurermdeploycommon/webdeployment-common/ziputility.js');
var azureStorage = require('azure-storage');

export class ConsumptionWebAppDeploymentProvider extends AzureRmWebAppDeploymentProvider {

    public async PreDeploymentStep() {
        this.appService = new AzureAppService(this.taskParams.azureEndpoint, this.taskParams.ResourceGroupName, this.taskParams.WebAppName, 
            this.taskParams.SlotName, this.taskParams.WebAppKind);
        this.appServiceUtility = new AzureAppServiceUtility(this.appService);
    }
 
    public async DeployWebAppStep() {
        let storageDetails =  await this.findStorageAccount();
        let sasUrl = await this.uploadPackage(storageDetails, this.taskParams.Package);
        await this.publishRunFromPackage(sasUrl);
    }

    private async findStorageAccount() {
        let appSettings = await this.appService.getApplicationSettings();
        var storageData = {};
        if(appSettings && appSettings.properties && appSettings.properties.AzureWebJobsStorage) {
            let webStorageSetting = appSettings.properties.AzureWebJobsStorage;
            let dictionary = getKeyValuePairs(webStorageSetting);
            tl.debug(`Storage Account is: ${dictionary["AccountName"]}`);
            storageData["AccountName"] = dictionary["AccountName"];
            storageData["AccountKey"] = dictionary["AccountKey"];
        }
        if(!storageData["AccountName"] || !storageData["AccountKey"]) {
            throw new Error(tl.loc('FailedToGetStorageAccountDetails'));
        }
        return storageData;
    }

    private async uploadPackage(storageDetails, deployPackage) : Promise<string> {
        var defer = Q.defer<string>();
        let storageAccount = storageDetails["AccountName"];
        let storageKey = storageDetails["AccountKey"];
        const blobService = azureStorage.createBlobService(storageAccount, storageKey);

        const containerName = 'azure-pipelines-deploy';
        const blobName = `package_${Date.now()}.zip`;
        let fileName;

        switch(deployPackage.getPackageType()){
            case PackageType.folder:
                let tempPackagePath = webCommonUtility.generateTemporaryFolderOrZipPath(tl.getVariable('AGENT.TEMPDIRECTORY'), false);
                let archivedWebPackage = await zipUtility.archiveFolder(deployPackage.getPath(), "", tempPackagePath);
                tl.debug("Compressed folder into zip " +  archivedWebPackage);
                fileName = archivedWebPackage;
            break;
            case PackageType.zip:
                fileName = deployPackage.getPath();
            break;
            default:
                throw new Error(tl.loc('Invalidwebapppackageorfolderpathprovided', deployPackage.getPath()));
        }

        blobService.createContainerIfNotExists(containerName, error => {
            if (error){
                defer.reject(error);
            }

            //upoading package
            blobService.createBlockBlobFromLocalFile(containerName, blobName, fileName, (error, result) => {
                if (error) {
                    defer.reject(error);
                }

                //generating SAS URL
                let startDate = new Date();
                let expiryDate = new Date(startDate);
                expiryDate.setFullYear(startDate.getUTCFullYear() + 1);
                startDate.setMinutes(startDate.getUTCMinutes() - 5);
            
                let sharedAccessPolicy = {
                    AccessPolicy: {
                        Permissions: azureStorage.BlobUtilities.SharedAccessPermissions.READ,
                        Start: startDate,
                        Expiry: expiryDate
                    }
                };
            
                let token = blobService.generateSharedAccessSignature(containerName, blobName, sharedAccessPolicy);
                let sasUrl = blobService.getUrl(containerName, blobName, token);
                tl.debug(`SAS URL is: ${sasUrl}`);
                defer.resolve(sasUrl);
            });
        });
        return defer.promise;
    }

    private async publishRunFromPackage(sasUrl) {
        await this.appService.patchApplicationSettings({'WEBSITE_RUN_FROM_PACKAGE': sasUrl});
        await sleepFor(5);
        await this.appService.syncFunctionTriggers();
        console.log(tl.loc('SyncFunctionTriggersSuccess'));
    }
}

function getKeyValuePairs(webStorageSetting : string) {
    let keyValuePair = {};
    var splitted = webStorageSetting.split(";");
    for(var keyValue of splitted) {
        let indexOfSeparator = keyValue.indexOf("=");
        let key: string = keyValue.substring(0,indexOfSeparator);
        let value: string = keyValue.substring(indexOfSeparator + 1);
        keyValuePair[key] = value;
    }
    return keyValuePair;
}