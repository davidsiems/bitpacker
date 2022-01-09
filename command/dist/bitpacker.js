var useDev = false;
var baseDevURL = 'http://localhost:4001/bit-packer/us-central1';
var baseLiveURL = 'https://us-central1-bit-packer.cloudfunctions.net';
var UploadPackageURL = `${useDev ? baseDevURL : baseLiveURL}/UploadPackage`;
var CreatePackageURL = `${useDev ? baseDevURL : baseLiveURL}/CreatePackage`;
export async function main(ns) {
    var flags = ns.flags([['quiet', false]]);
    var options = {
        quiet: flags.quiet
    };
    var command = flags._[0];
    switch (command) {
        case 'install':
            CheckRunning(ns, options);
            var latest = flags._[1] === 'latest';
            await BitpackInstall(ns, options, latest);
            break;
        case 'cleanslate':
            CheckRunning(ns, options);
            await BitpackCleanslate(ns, options);
            break;
        case 'add': {
            CheckRunning(ns, options);
            var bitpack = flags._[1];
            var version = flags._[2];
            await BitpackAdd(ns, options, bitpack, version);
            break;
        }
        case 'remove': {
            CheckRunning(ns, options);
            var bitpack = flags._[1];
            await BitpackRemove(ns, options, bitpack);
            break;
        }
        case 'list': {
            await List(ns, options);
            break;
        }
        case 'create': {
            var packagePath = flags._[1];
            var bitpackName = flags._[2];
            await Create(ns, options, packagePath, bitpackName);
            break;
        }
        case 'publish': {
            var packagePath = flags._[1];
            var key = flags._[2];
            await Publish(ns, options, packagePath);
            break;
        }
        case 'help': {
            break;
        }
        case 'man': {
            var bitpack = flags._[1];
            Manual(ns, options, bitpack);
            break;
        }
    }
}
export async function BitpackInstall(ns, options, latest) {
    DeleteAllBitpacks(ns, options);
    var failures = 0;
    var packages = 0;
    var manifest = LoadManifest(ns);
    if (manifest === null)
        return false;
    if (manifest === undefined)
        manifest = await CreateManifest(ns);
    for (var bitpack in manifest.bitpacks) {
        var targetVersion = latest ? 'latest' : manifest.bitpacks[bitpack];
        var metadata = await DownloadBitpack(ns, options, bitpack, targetVersion);
        if (!metadata) {
            ++failures;
        }
        else {
            manifest.bitpacks[bitpack] = `${metadata.version}`;
        }
        ++packages;
    }
    await SaveManifest(ns, manifest);
    if (failures > 0)
        Print(ns, options, `Bitpack Failed to install ${failures} package${failures === 1 ? 's' : ''}`);
    else
        Print(ns, options, `Bitpack installed ${packages} package${packages === 1 ? 's' : ''}`);
    return failures === 0;
}
export function BitpackIsInstalled(ns, options, bitpack) {
    var manifest = LoadManifest(ns);
    if (manifest) {
        var version = manifest.bitpacks[bitpack];
        return !!version;
    }
    return false;
}
export async function BitpackCleanslate(ns, options) {
    DeleteAllBitpacks(ns, options);
    await CreateManifest(ns);
}
async function BitpackAdd(ns, options, bitpack, version) {
    if (!version)
        version = 'latest';
    var manifest = LoadManifest(ns);
    if (manifest === null)
        return false;
    if (manifest === undefined)
        manifest = await CreateManifest(ns);
    var existing = manifest.bitpacks[bitpack];
    if ((existing && existing !== version) || !existing) {
        var metadata = await DownloadBitpack(ns, options, bitpack, version);
        if (!metadata) {
            return false;
        }
        else {
            manifest.bitpacks[bitpack] = `${metadata.version}`;
            await SaveManifest(ns, manifest);
        }
    }
    return true;
}
async function BitpackRemove(ns, options, bitpack) {
    var manifest = await RequireManifest(ns);
    if (!manifest)
        return;
    var version = manifest.bitpacks[bitpack];
    if (version) {
        delete manifest.bitpacks[bitpack];
        await SaveManifest(ns, manifest);
    }
    DeleteBitpack(ns, options, bitpack);
    Print(ns, options, `Bitpack removed ${bitpack}:${version ? version : ''}`);
}
async function List(ns, options) {
    var manifest = await RequireManifest(ns);
    if (!manifest)
        return;
    var output = ``;
    for (var bitpack in manifest.bitpacks)
        output += `\n  ${bitpack}:${manifest.bitpacks[bitpack]}`;
    if (output !== '')
        Print(ns, options, output);
}
async function Create(ns, options, packagePath, bitpackName) {
    if (!packagePath.startsWith('/'))
        packagePath = `/${packagePath}`;
    if (!packagePath.endsWith('/'))
        packagePath = `${packagePath}/`;
    var filesInPath = ns.ls(ns.getHostname(), packagePath);
    for (var file of filesInPath) {
        if (!file.startsWith(packagePath))
            continue;
        if (file.endsWith('package.txt')) {
            PrintError(ns, `package.txt already exists. Aborting package creation.`);
            return false;
        }
    }
    var createRequest = {
        bitpack: bitpackName
    };
    var createRequestPayload = JSON.stringify(createRequest);
    var xhr = new XMLHttpRequest();
    xhr.open('POST', CreatePackageURL, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(createRequestPayload);
    var key = '';
    var error = '';
    var uploadResultOp = new Promise((resolve, reject) => {
        xhr.onreadystatechange = () => {
            if (xhr.readyState === XMLHttpRequest.DONE) {
                var response;
                try {
                    response = JSON.parse(xhr.responseText);
                    if (response.error) {
                        error = response.error;
                        resolve(false);
                    }
                    else {
                        key = response.key;
                        resolve(true);
                    }
                }
                catch (syntaxError) {
                    resolve(false);
                }
            }
        };
        xhr.onerror = () => {
            resolve(false);
        };
    });
    var result = await uploadResultOp;
    if (!result) {
        PrintError(ns, error);
        return false;
    }
    var bitpack = {
        uniqueName: bitpackName,
        author: '',
        descriptiveName: '',
        shortDescription: '',
        longDescription: '',
        tags: [],
        publishKey: key
    };
    await ns.write(`${packagePath}package.txt`, JSON.stringify(bitpack, undefined, 4));
    Print(ns, options, `Successfully created ${bitpackName}.

Your publishing key is ${key} and has been saved into your local package.txt.
Consider backing it up elsewhere and don't share it with anyone you don't want to be able to publish your package.
Develop your package and then publish using the 'bp publish' command.
`);
    return true;
}
async function Publish(ns, options, packagePath) {
    if (!packagePath.startsWith('/'))
        packagePath = `/${packagePath}`;
    if (!packagePath.endsWith('/'))
        packagePath = `${packagePath}/`;
    if (packagePath.startsWith('/bitpacks') || packagePath.startsWith('bitpacks')) {
        PrintError(ns, `Publish aborted. Can't publish from the /bitpacks directory.`);
        return false;
    }
    var packMetadata = LoadMetadata(ns, `${packagePath}package.txt`);
    if (packMetadata === null) {
        PrintError(ns, `Publish aborted. Invalid package.txt`);
        return false;
    }
    var publishKey = packMetadata.publishKey;
    if (!publishKey) {
        PrintError(ns, `Publish aborted. Missing publishKey`);
        return false;
    }
    delete packMetadata.publishKey;
    var packFilenames = ns.ls(ns.getHostname(), packagePath);
    var packFiles = {};
    for (var filename of packFilenames) {
        if (!filename.startsWith(packagePath))
            continue;
        var fileData = ns.read(filename);
        if (filename === `${packagePath}package.txt`) {
            var metadata = JSON.parse(fileData);
            delete metadata.publishKey;
            fileData = JSON.stringify(metadata, undefined, 4);
        }
        packFiles[filename.replace(packagePath, '')] = fileData;
    }
    var pack = {
        metadata: packMetadata,
        files: packFiles,
        key: publishKey
    };
    var packPayload = JSON.stringify(pack);
    var xhr = new XMLHttpRequest();
    xhr.open('POST', UploadPackageURL, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(packPayload);
    var version = -1;
    var error = '';
    var uploadResultOp = new Promise((resolve, reject) => {
        xhr.onreadystatechange = () => {
            if (xhr.readyState === XMLHttpRequest.DONE) {
                var response;
                try {
                    response = JSON.parse(xhr.responseText);
                    if (response.error) {
                        error = response.error;
                        resolve(false);
                    }
                    else {
                        version = response.version;
                        resolve(true);
                    }
                }
                catch (syntaxError) {
                    resolve(false);
                }
            }
        };
        xhr.onerror = () => {
            resolve(false);
        };
    });
    var result = await uploadResultOp;
    if (result)
        Print(ns, options, `${packMetadata.uniqueName}:${version} published`);
    else
        PrintError(ns, error);
    return result;
}
function Manual(ns, options, bitpack) {
    if (!BitpackIsInstalled(ns, options, bitpack)) {
        Print(ns, options, `${bitpack} is not installed`);
        return;
    }
    var manual = ns.read(`/bitpacks/${bitpack}/manual.txt`);
    if (manual === '')
        Print(ns, options, `No manual found for ${bitpack}`);
    Print(ns, options, `\n${manual}`);
}
async function DownloadBitpack(ns, options, bitpack, version) {
    var downloadResultOp = new Promise((resolve, reject) => {
        var xhr = new XMLHttpRequest();
        var apiKey = 'AIzaSyAdqErjegWi8CFRMfrCFNn6Wf9GmR1kBl0';
        var doc = `bitpacks/${bitpack}%3A${version}`;
        var url = `https://firestore.googleapis.com/v1beta1/projects/bit-packer/databases/(default)/documents/${doc}?key=${apiKey}`;
        xhr.onreadystatechange = function () {
            if (xhr.readyState == XMLHttpRequest.DONE) {
                var responseJson = null;
                try {
                    responseJson = JSON.parse(xhr.responseText);
                    if (responseJson.error)
                        resolve(null);
                    else {
                        resolve(ConvertFirestoreObject(responseJson).fields);
                    }
                }
                catch (syntaxError) {
                    resolve(null);
                }
            }
        };
        xhr.onerror = () => {
            resolve(null);
        };
        xhr.open('GET', url, true);
        xhr.send(null);
    });
    var payload = await downloadResultOp;
    if (!payload) {
        PrintError(ns, `Failed to download ${bitpack}:${version}`);
        return null;
    }
    DeleteBitpack(ns, options, bitpack);
    for (var filename in payload.files) {
        await ns.write(`/bitpacks/${bitpack}/${filename}`, payload.files[filename], 'w');
    }
    Print(ns, options, `Bitpack installed ${bitpack}:${payload.metadata.version}`);
    return payload.metadata;
}
function DeleteBitpack(ns, options, bitpack) {
    var files = ns.ls(ns.getHostname(), `/bitpacks/${bitpack}`);
    for (var file of files) {
        if (!file.startsWith(`/bitpacks/${bitpack}`))
            continue;
        if (options.verbose)
            Print(ns, options, `Deleting ${file}`);
        ns.rm(file);
    }
}
function DeleteAllBitpacks(ns, options) {
    var files = ns.ls(ns.getHostname(), '/bitpacks/');
    for (var file of files) {
        if (!file.startsWith('/bitpacks/'))
            continue;
        if (file.startsWith(`/bitpacks/bitpacker.js`))
            continue;
        if (options.verbose)
            Print(ns, options, `Deleting ${file}`);
        ns.rm(file);
    }
}
function LoadManifest(ns) {
    var manifestJSON = ns.read('packages.txt');
    if (manifestJSON === '')
        return undefined;
    var manifest = null;
    try {
        manifest = JSON.parse(manifestJSON);
    }
    catch (syntaxError) {
        PrintError(ns, `Couldn't parse packages.txt\n\n${syntaxError}`);
    }
    return manifest;
}
async function CreateManifest(ns) {
    var manifest = {
        bitpacks: {}
    };
    await SaveManifest(ns, manifest);
    return manifest;
}
async function SaveManifest(ns, manifest) {
    var manifestJSON = JSON.stringify(manifest, undefined, 4);
    await ns.write('packages.txt', manifestJSON, 'w');
}
async function RequireManifest(ns) {
    var manifest = LoadManifest(ns);
    if (!manifest)
        PrintError(ns, `package.txt not found`);
    return manifest;
}
function LoadMetadata(ns, path) {
    var metadataJSON = ns.read(path);
    if (metadataJSON === '')
        return null;
    var metadata = null;
    try {
        metadata = JSON.parse(metadataJSON);
    }
    catch (syntaxError) {
        PrintError(ns, `Couldn't parse package.txt:\n\n${syntaxError}`);
        return null;
    }
    return metadata;
}
function CheckRunning(ns, options) {
    var running = ns.ps();
    if (running.length > 1)
        Print(ns, options, `Detected running scripts. It's recommended to kill all scripts before running bitpack.`);
}
function Print(ns, options, value) {
    if (options.quiet)
        return;
    ns.tprint(value);
}
function PrintError(ns, value) {
    ns.tprint(`BITPACK ERROR: ${value}`);
}
function GetFirestoreProperty(value) {
    const props = {
        arrayValue: true,
        bytesValue: true,
        booleanValue: true,
        doubleValue: true,
        geoPointValue: true,
        integerValue: true,
        mapValue: true,
        nullValue: true,
        referenceValue: true,
        stringValue: true,
        timestampValue: true
    };
    return Object.keys(value).find((k) => props[k]);
}
function ConvertFirestoreObject(json) {
    const prop = GetFirestoreProperty(json);
    if (prop === 'doubleValue' || prop === 'integerValue') {
        json = Number(json[prop]);
    }
    else if (prop === 'arrayValue') {
        json = ((json[prop] && json[prop].values) || []).map((v) => ConvertFirestoreObject(v));
    }
    else if (prop === 'mapValue') {
        json = ConvertFirestoreObject((json[prop] && json[prop].fields) || {});
    }
    else if (prop === 'geoPointValue') {
        json = { latitude: 0, longitude: 0, ...json[prop] };
    }
    else if (prop) {
        json = json[prop];
    }
    else if (typeof json === 'object') {
        Object.keys(json).forEach((k) => (json[k] = ConvertFirestoreObject(json[k])));
    }
    return json;
}
