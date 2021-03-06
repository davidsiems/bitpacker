var useDev = false;
var baseDevURL = 'http://localhost:5001/bit-packer/us-central1';
var baseLiveURL = 'https://us-central1-bit-packer.cloudfunctions.net';
var UploadPackageURL = `${useDev ? baseDevURL : baseLiveURL}/UploadPackage`;
var CreatePackageURL = `${useDev ? baseDevURL : baseLiveURL}/CreatePackage`;
var DownloadPackageURL = `${useDev ? baseDevURL : baseLiveURL}/DownloadPackage`;
var BitpackerURL = `https://raw.githubusercontent.com/davidsiems/bitpacker/live/command/dist/bp.js?${Date.now()}`;
var Commands = {
    browse: {
        command: browse,
        help: `    bp browse                                // Lists available packages and their details`,
        validate: (args) => true
    },
    add: {
        command: add,
        help: `    bp add package-name                      // Installs latest version of the package 'package-name'
    bp add package-name version              // Installs the specified version of 'package-name'
    bp add package-name --no-alias           // Disables alias installation for this package`,
        validate: (args) => {
            if (args.length === 0 || args.length > 2)
                return false;
            return true;
        }
    },
    remove: {
        command: remove,
        help: `    bp remove package-name                   // Removes the specified package`,
        validate: (args) => {
            if (args.length == 0 || args.length > 1)
                return false;
            return true;
        }
    },
    man: {
        command: man,
        help: `    bp man package-name                      // Prints out manual.txt for the specified package (if it exists)`,
        validate: (args) => {
            return args.length === 1;
        }
    },
    install: {
        command: install,
        help: `    bp install                               // Installs versions specified in packages.txt
    bp install latest                        // Updates packages to latest versions`,
        validate: (args) => {
            return args.length === 0 || (args.length === 1 && args[0] === 'latest');
        }
    },
    cleanslate: {
        command: cleanslate,
        help: `    bp cleanslate                            // Removes all installed packages and clears packages.txt`,
        validate: (args) => {
            return args.length === 0;
        }
    },
    list: {
        command: list,
        help: `    bp list                                  // Lists installed packages and their versions`,
        validate: (args) => {
            return args.length === 0;
        }
    },
    create: {
        command: create,
        help: `    bp create /path/to/package package-name  // Creates and registers a new package`,
        validate: (args) => {
            return args.length === 2;
        }
    },
    publish: {
        command: publish,
        help: `    bp publish /path/to/package              // Publishes a package to the registry`,
        validate: (args) => {
            return args.length === 1;
        }
    },
    'update-bp': {
        command: update_bp,
        help: `    bp update-bp                             // Updates bitpacker to latest`,
        validate: (args) => {
            return args.length === 0;
        }
    },
    help: {
        command: help,
        help: `    bp help                                  // Displays this help text`,
        validate: (args) => true
    }
};
export async function main(ns) {
    var flags = ns.flags([
        ['quiet', false],
        ['q', false],
        ['verbose', false],
        ['no-alias', false]
    ]);
    var options = {
        quiet: flags.quiet || flags.q,
        verbose: flags.verbose,
        noAlias: flags['no-alias']
    };
    var [commandKey, ...args] = flags._;
    var command = Commands[commandKey];
    if (!command)
        command = Commands.help;
    if (!command.validate(args))
        command = Commands.help;
    if (commandKey !== 'update-bp')
        await CheckUpdate(ns, options);
    await command.command(ns, options, args);
}
async function update_bp(ns, options, args) {
    await ns.wget(BitpackerURL, '/bitpacks/bp.js');
    Print(ns, options, 'Updated Bitpacker to latest');
}
async function install(ns, options, args) {
    CheckRunning(ns, options);
    var latest = args[0] === 'latest';
    await BitpackInstall(ns, options, latest);
}
async function cleanslate(ns, options, args) {
    CheckRunning(ns, options);
    await BitpackCleanslate(ns, options);
}
async function add(ns, options, args) {
    CheckRunning(ns, options);
    var bitpack = args[0];
    var version = args[1];
    await BitpackAdd(ns, options, bitpack, version);
}
async function remove(ns, options, args) {
    CheckRunning(ns, options);
    var bitpack = args[0];
    await BitpackRemove(ns, options, bitpack);
}
async function list(ns, options, args) {
    await List(ns, options);
}
async function create(ns, options, args) {
    var packagePath = args[0];
    var bitpackName = args[1];
    await Create(ns, options, packagePath, bitpackName);
}
async function publish(ns, options, args) {
    var packagePath = args[0];
    await Publish(ns, options, packagePath);
}
async function man(ns, options, args) {
    var bitpack = args[0];
    Manual(ns, options, bitpack);
}
async function browse(ns, options, args) {
    await ListBitpacks(ns, options);
}
async function help(ns, options, args) {
    var output = '\nBitpacker - a simple package manager for Bitburner\n';
    output += '    flags:\n        -q --quiet, Run with reduced output\n\n';
    for (var commandName in Commands) {
        output += `${Commands[commandName].help}\n`;
    }
    Print(ns, options, output);
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
            if (options.noAlias) {
                if (!manifest.options)
                    manifest.options = {};
                if (!manifest.options[bitpack])
                    manifest.options[bitpack] = {};
                manifest.options[bitpack].noAlias = true;
            }
            await SaveManifest(ns, manifest);
        }
    }
    return true;
}
async function BitpackRemove(ns, options, bitpack) {
    var manifest = await RequireManifest(ns);
    if (!manifest)
        return;
    await DeleteBitpack(ns, options, bitpack);
    var version = manifest.bitpacks[bitpack];
    if (version) {
        delete manifest.bitpacks[bitpack];
        if (manifest.options && manifest.options[bitpack])
            delete manifest.options[bitpack];
        await SaveManifest(ns, manifest);
    }
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
        aliases: {}
    };
    await ns.write(`${packagePath}package.txt`, JSON.stringify(bitpack, undefined, 4));
    var bitpackKey = {
        publishKey: key
    };
    await ns.write(`${packagePath}publishing-key.txt`, JSON.stringify(bitpackKey, undefined, 4));
    Print(ns, options, `Successfully created ${bitpackName}.

Your publishing key is ${key} and has been saved into your local publishing-key.txt file.
Consider backing it up elsewhere and don't share it with anyone you don't want to be able to publish your package.
Make sure to add publishing-key.txt to files like a .gitignore file if you're publicly publishing your package source.
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
    if (publishKey) {
        var keyFile = {
            publishKey: publishKey
        };
        await ns.write(`${packagePath}publishing-key.txt`, JSON.stringify(keyFile, undefined, 4), 'w');
        delete packMetadata.publishKey;
        await ns.write(`${packagePath}package.txt`, JSON.stringify(packMetadata, undefined, 4), 'w');
    }
    var publishKeyFile = LoadKeyFile(ns, `${packagePath}publishing-key.txt`);
    if (!publishKeyFile || !publishKeyFile.publishKey) {
        PrintError(ns, `Publish aborted. Missing publishing-key.txt`);
        return false;
    }
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
        if (filename === `${packagePath}publishing-key.txt`)
            continue;
        var packagePathNoLeadingSlash = packagePath.startsWith('/') ? packagePath.slice(1) : packagePath;
        var regexString = `import([^'"]+)(?=\\s*from)\\s*from\\s*(['"])\/*${packagePathNoLeadingSlash}(.*)(['"])`;
        var regex = RegExp(regexString, 'gm');
        if (filename.endsWith('.js') || filename.endsWith('.ns') || filename.endsWith('.script')) {
            fileData = fileData.replaceAll(regex, `import$1from $2/bitpacks/${packMetadata.uniqueName}/$3$4;`);
        }
        packFiles[filename.replace(packagePath, '')] = fileData;
    }
    var pack = {
        metadata: packMetadata,
        files: packFiles,
        key: publishKeyFile.publishKey
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
                if (xhr.responseText === '' || !xhr.responseText) {
                    error = 'Service unreachable.';
                    resolve(false);
                    return;
                }
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
            error = `Service unreachable.`;
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
    var request = {
        bitpack: bitpack,
        version: version
    };
    var requestPayload = JSON.stringify(request);
    var xhr = new XMLHttpRequest();
    xhr.open('POST', DownloadPackageURL, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(requestPayload);
    var error = '';
    var downloadResultOp = new Promise((resolve, reject) => {
        xhr.onreadystatechange = function () {
            if (xhr.readyState == XMLHttpRequest.DONE) {
                try {
                    var responseJson = JSON.parse(xhr.responseText);
                    if (responseJson.error) {
                        error = responseJson.error;
                        resolve(null);
                    }
                    else {
                        resolve(responseJson.bitpack);
                    }
                }
                catch (syntaxError) {
                    resolve(null);
                }
            }
        };
        xhr.onerror = () => {
            error = `Service unreachable.`;
            resolve(null);
        };
    });
    var payload = await downloadResultOp;
    if (!payload) {
        PrintError(ns, `Failed to download ${bitpack}:${version}\n    ${error}`);
        return null;
    }
    await DeleteBitpack(ns, options, bitpack);
    for (var filename in payload.files) {
        await ns.write(`/bitpacks/${bitpack}/${filename}`, payload.files[filename], 'w');
    }
    Print(ns, options, `Bitpack installed ${bitpack}:${payload.metadata.version}`);
    if (payload.metadata.welcome)
        Print(ns, options, payload.metadata.welcome);
    if (payload.metadata.aliases) {
        var manifest = LoadManifest(ns);
        var alias = !(manifest?.options && manifest.options[bitpack] && manifest.options[bitpack].noAlias);
        if (alias) {
            for (var aliasName in payload.metadata.aliases) {
                var aliasPath = `/bitpacks/${bitpack}/${payload.metadata.aliases[aliasName]}`;
                InstallAlias(aliasName, aliasPath);
            }
        }
    }
    return payload.metadata;
}
function InstallAlias(aliasName, aliasPath) {
    RunTerminalCommand(`alias ${aliasName}="run ${aliasPath}"`);
}
function UninstallAlias(aliasName) {
    RunTerminalCommand(`unalias ${aliasName}`);
}
function RunTerminalCommand(command) {
    const doc = eval('document');
    const terminalInput = doc.getElementById('terminal-input');
    terminalInput.value = command;
    const handler = Object.keys(terminalInput)[1];
    terminalInput[handler].onChange({ target: terminalInput });
    terminalInput[handler].onKeyDown({ keyCode: 13, preventDefault: () => null });
}
async function ListBitpacks(ns, options) {
    var downloadResultOp = new Promise((resolve, reject) => {
        var xhr = new XMLHttpRequest();
        var apiKey = 'AIzaSyAdqErjegWi8CFRMfrCFNn6Wf9GmR1kBl0';
        var url = `https://firestore.googleapis.com/v1/projects/bit-packer/databases/(default)/documents/bitpack-registry?key=${apiKey}`;
        xhr.onreadystatechange = function () {
            if (xhr.readyState == XMLHttpRequest.DONE) {
                var responseJson = null;
                try {
                    responseJson = JSON.parse(xhr.responseText);
                    if (responseJson.error) {
                        ns.tprint(responseJson.error);
                        resolve(null);
                    }
                    else {
                        var docs = [];
                        for (var docIndex in responseJson.documents) {
                            var doc = responseJson.documents[docIndex];
                            docs.push(ConvertFirestoreObject(doc.fields));
                        }
                        resolve(docs);
                    }
                }
                catch (syntaxError) {
                    ns.tprint(`${syntaxError}`);
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
    var result = await downloadResultOp;
    if (result) {
        result.sort((a, b) => {
            if (a.uniqueName < b.uniqueName) {
                return -1;
            }
            if (a.uniqueName > b.uniqueName) {
                return 1;
            }
            return 0;
        });
        var output = 'Packages in the bitpack registry:\n';
        for (var entry of result) {
            output += `    ${entry.uniqueName}: ${entry.shortDescription}\n`;
        }
        Print(ns, options, output);
    }
    else
        PrintError(ns, `Failed to fetch registry`);
}
async function DeleteBitpack(ns, options, bitpack) {
    var manifest = LoadManifest(ns);
    if (!manifest || !manifest.options || !manifest.options[bitpack] || !manifest.options[bitpack].noAlias) {
        var metadata = LoadMetadata(ns, `/bitpacks/${bitpack}/package.txt`);
        if (metadata && metadata.aliases) {
            for (var aliasName in metadata.aliases) {
                UninstallAlias(aliasName);
            }
        }
    }
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
    var installedBitpacks = {};
    for (var file of files) {
        if (!file.startsWith('/bitpacks/'))
            continue;
        if (file.startsWith(`/bitpacks/bp.js`))
            continue;
        installedBitpacks[file.split('/')[2]] = true;
    }
    for (var bitpack in installedBitpacks)
        DeleteBitpack(ns, options, bitpack);
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
        bitpacks: {},
        options: {}
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
function LoadKeyFile(ns, path) {
    var keyFileJson = ns.read(path);
    if (keyFileJson === '')
        return null;
    var keyFile = null;
    try {
        keyFile = JSON.parse(keyFileJson);
    }
    catch (syntaxError) {
        PrintError(ns, `Couldn't parse publishing-key.txt:\n\n${syntaxError}`);
        return null;
    }
    return keyFile;
}
function CheckRunning(ns, options) {
    var running = ns.ps();
    if (running.length > 1)
        Print(ns, options, `Detected running scripts. It's recommended to kill all scripts before running bitpack.`);
}
async function CheckUpdate(ns, options) {
    if (await ns.wget(BitpackerURL, '/bitpacks/bp_check.js')) {
        var newData = ns.read('/bitpacks/bp_check.js');
        var oldData = ns.read('/bitpacks/bp.js');
        ns.rm('/bitpacks/bp_check.js', ns.getHostname());
        if (newData !== oldData)
            Print(ns, options, `A new version of bitpacker is available. Run 'bp update-bp' to upgrade.`);
    }
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
