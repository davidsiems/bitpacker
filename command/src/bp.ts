import { NS } from 'bitburner';

var useDev = false;
var baseDevURL = 'http://localhost:5001/bit-packer/us-central1';
var baseLiveURL = 'https://us-central1-bit-packer.cloudfunctions.net';
var UploadPackageURL = `${useDev ? baseDevURL : baseLiveURL}/UploadPackage`;
var CreatePackageURL = `${useDev ? baseDevURL : baseLiveURL}/CreatePackage`;
var BitpackerURL = `https://raw.githubusercontent.com/davidsiems/bitpacker/live/command/dist/bp.js?${Date.now()}`;

var Commands = {
    browse: {
        command: browse,
        help: `    bp browse                                // Lists available packages and their details`,
        validate: (args: string[]) => true
    },
    add: {
        command: add,
        help: `    bp add package-name                      // Installs latest version of the package 'package-name'
    bp add package-name version              // Installs the specified version of 'package-name'`,
        validate: (args: string[]) => {
            if (args.length === 0 || args.length > 2) return false;
            return true;
        }
    },
    remove: {
        command: remove,
        help: `    bp remove package-name                   // Removes the specified package`,
        validate: (args: string[]) => {
            if (args.length == 0 || args.length > 1) return false;
            return true;
        }
    },
    man: {
        command: man,
        help: `    bp man package-name                      // Prints out manual.txt for the specified package (if it exists)`,
        validate: (args: string[]) => {
            return args.length === 1;
        }
    },
    install: {
        command: install,
        help: `    bp install                               // Installs versions specified in packages.txt
    bp install latest                        // Updates packages to latest versions`,
        validate: (args: string[]) => {
            return args.length === 0 || (args.length === 1 && args[0] === 'latest');
        }
    },
    cleanslate: {
        command: cleanslate,
        help: `    bp cleanslate                            // Removes all installed packages and clears packages.txt`,
        validate: (args: string[]) => {
            return args.length === 0;
        }
    },
    list: {
        command: list,
        help: `    bp list                                  // Lists installed packages and their versions`,
        validate: (args: string[]) => {
            return args.length === 0;
        }
    },
    create: {
        command: create,
        help: `    bp create /path/to/package package-name  // Creates and registers a new package`,
        validate: (args: string[]) => {
            return args.length === 2;
        }
    },
    publish: {
        command: publish,
        help: `    bp publish /path/to/package              // Publishes a package to the registry`,
        validate: (args: string[]) => {
            return args.length === 1;
        }
    },
    'update-bp': {
        command: update_bp,
        help: `    bp update-bp                             // Updates bitpacker to latest`,
        validate: (args: string[]) => {
            return args.length === 0;
        }
    },
    help: {
        command: help,
        help: `    bp help                                  // Displays this help text`,
        validate: (args: string[]) => true
    }
};

export async function main(ns: NS) {
    var flags = ns.flags([
        ['quiet', false],
        ['q', false]
    ]);

    var options: CommandOptions = {
        quiet: flags.quiet || flags.q
    };

    await CheckUpdate(ns, options);

    var [commandKey, ...args] = flags._;
    var command = Commands[commandKey as keyof typeof Commands];
    if (!command) command = Commands.help;
    if (!command.validate(args)) command = Commands.help;
    await command.command(ns, options, args);
}

async function update_bp(ns: NS, options: CommandOptions, args: string[]) {
    await ns.wget(BitpackerURL, '/bitpacks/bp.js');
    Print(ns, options, 'Updated Bitpacker to latest');
}

async function install(ns: NS, options: CommandOptions, args: string[]) {
    CheckRunning(ns, options);
    var latest = args[0] === 'latest';
    await BitpackInstall(ns, options, latest);
}

async function cleanslate(ns: NS, options: CommandOptions, args: string[]) {
    CheckRunning(ns, options);
    await BitpackCleanslate(ns, options);
}

async function add(ns: NS, options: CommandOptions, args: string[]) {
    CheckRunning(ns, options);
    var bitpack = args[0];
    var version = args[1];
    await BitpackAdd(ns, options, bitpack, version);
}

async function remove(ns: NS, options: CommandOptions, args: string[]) {
    CheckRunning(ns, options);
    var bitpack = args[0];
    await BitpackRemove(ns, options, bitpack);
}

async function list(ns: NS, options: CommandOptions, args: string[]) {
    await List(ns, options);
}

async function create(ns: NS, options: CommandOptions, args: string[]) {
    var packagePath = args[0];
    var bitpackName = args[1];
    await Create(ns, options, packagePath, bitpackName);
}

async function publish(ns: NS, options: CommandOptions, args: string[]) {
    var packagePath = args[0];
    await Publish(ns, options, packagePath);
}

async function man(ns: NS, options: CommandOptions, args: string[]) {
    var bitpack = args[0];
    Manual(ns, options, bitpack);
}

async function browse(ns: NS, options: CommandOptions, args: string[]) {
    await ListBitpacks(ns, options);
}

async function help(ns: NS, options: CommandOptions, args: string[]) {
    var output = '\nBitpacker - a simple package manager for Bitburner\n';
    output += '    flags:\n        -q --quiet, Run with reduced output\n\n';
    for (var commandName in Commands) {
        output += `${Commands[commandName as keyof typeof Commands].help}\n`;
    }
    Print(ns, options, output);
}

interface BitpackMetadata {
    uniqueName: string;
    shortDescription: string;
    tags: string[];
    version?: number;
    publishKey?: string;

    author?: string;
    descriptiveName?: string;
    longDescription?: string;
}

interface BitpackPublishRequest {
    metadata: BitpackMetadata;
    files: Record<string, string>;
    key: string;
}

interface BitpackPublishResponse {
    error?: string;
    ok?: boolean;
    version?: number;
}

interface BitpackCreateRequest {
    bitpack: string;
}

interface BitpackCreateResponse {
    error?: string;
    ok?: boolean;
    key?: string;
}

interface Bitpack {
    metadata: BitpackMetadata;
    files: Record<string, string>;
}

interface BitpackManifest {
    bitpacks: Record<string, string>;
}

interface BitpackRegistry {
    uniqueName: string;
    shortDescription: string;
    author?: string;
    tags: string[];
}

export interface CommandOptions {
    quiet?: boolean;
    verbose?: boolean;
}

export async function BitpackInstall(ns: NS, options: CommandOptions, latest: boolean): Promise<boolean> {
    DeleteAllBitpacks(ns, options);

    var failures = 0;
    var packages = 0;
    var manifest = LoadManifest(ns);
    if (manifest === null) return false;
    if (manifest === undefined) manifest = await CreateManifest(ns);

    for (var bitpack in manifest.bitpacks) {
        var targetVersion = latest ? 'latest' : manifest.bitpacks[bitpack];
        var metadata = await DownloadBitpack(ns, options, bitpack, targetVersion);
        if (!metadata) {
            ++failures;
        } else {
            manifest.bitpacks[bitpack] = `${metadata.version}`;
        }
        ++packages;
    }
    await SaveManifest(ns, manifest);
    if (failures > 0) Print(ns, options, `Bitpack Failed to install ${failures} package${failures === 1 ? 's' : ''}`);
    else Print(ns, options, `Bitpack installed ${packages} package${packages === 1 ? 's' : ''}`);
    return failures === 0;
}

export function BitpackIsInstalled(ns: NS, options: CommandOptions, bitpack: string) {
    var manifest = LoadManifest(ns);
    if (manifest) {
        var version = manifest.bitpacks[bitpack];
        return !!version;
    }
    return false;
}

export async function BitpackCleanslate(ns: NS, options: CommandOptions) {
    DeleteAllBitpacks(ns, options);
    await CreateManifest(ns);
}

async function BitpackAdd(ns: NS, options: CommandOptions, bitpack: string, version?: string): Promise<boolean> {
    if (!version) version = 'latest';
    var manifest = LoadManifest(ns);
    if (manifest === null) return false;
    if (manifest === undefined) manifest = await CreateManifest(ns);

    var existing = manifest.bitpacks[bitpack];
    if ((existing && existing !== version) || !existing) {
        var metadata = await DownloadBitpack(ns, options, bitpack, version);
        if (!metadata) {
            return false;
        } else {
            manifest.bitpacks[bitpack] = `${metadata.version}`;
            await SaveManifest(ns, manifest);
        }
    }

    return true;
}

async function BitpackRemove(ns: NS, options: CommandOptions, bitpack: string) {
    var manifest = await RequireManifest(ns);
    if (!manifest) return;

    var version = manifest.bitpacks[bitpack];
    if (version) {
        delete manifest.bitpacks[bitpack];
        await SaveManifest(ns, manifest);
    }
    DeleteBitpack(ns, options, bitpack);
    Print(ns, options, `Bitpack removed ${bitpack}:${version ? version : ''}`);
}

async function List(ns: NS, options: CommandOptions) {
    var manifest = await RequireManifest(ns);
    if (!manifest) return;

    var output = ``;
    for (var bitpack in manifest.bitpacks) output += `\n  ${bitpack}:${manifest.bitpacks[bitpack]}`;
    if (output !== '') Print(ns, options, output);
}

async function Create(ns: NS, options: CommandOptions, packagePath: string, bitpackName: string): Promise<boolean> {
    if (!packagePath.startsWith('/')) packagePath = `/${packagePath}`;
    if (!packagePath.endsWith('/')) packagePath = `${packagePath}/`;

    var filesInPath = ns.ls(ns.getHostname(), packagePath);
    for (var file of filesInPath) {
        if (!file.startsWith(packagePath)) continue;
        if (file.endsWith('package.txt')) {
            PrintError(ns, `package.txt already exists. Aborting package creation.`);
            return false;
        }
    }

    var createRequest: BitpackCreateRequest = {
        bitpack: bitpackName
    };
    var createRequestPayload = JSON.stringify(createRequest);

    var xhr = new XMLHttpRequest();
    xhr.open('POST', CreatePackageURL, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(createRequestPayload);

    var key = '';
    var error = '';
    var uploadResultOp = new Promise<boolean>((resolve, reject) => {
        xhr.onreadystatechange = () => {
            if (xhr.readyState === XMLHttpRequest.DONE) {
                var response: BitpackCreateResponse;
                try {
                    response = JSON.parse(xhr.responseText);
                    if (response.error) {
                        error = response.error;
                        resolve(false);
                    } else {
                        key = response.key as string;
                        resolve(true);
                    }
                } catch (syntaxError) {
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

    var bitpack: BitpackMetadata = {
        uniqueName: bitpackName,
        author: '',
        descriptiveName: '',
        shortDescription: '',
        longDescription: '',
        tags: [],
        publishKey: key
    };
    await ns.write(`${packagePath}package.txt`, JSON.stringify(bitpack, undefined, 4));
    Print(
        ns,
        options,
        `Successfully created ${bitpackName}.

Your publishing key is ${key} and has been saved into your local package.txt.
Consider backing it up elsewhere and don't share it with anyone you don't want to be able to publish your package.
Develop your package and then publish using the 'bp publish' command.
`
    );
    return true;
}

async function Publish(ns: NS, options: CommandOptions, packagePath: string): Promise<boolean> {
    if (!packagePath.startsWith('/')) packagePath = `/${packagePath}`;
    if (!packagePath.endsWith('/')) packagePath = `${packagePath}/`;

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
    var packFiles: Record<string, string> = {};

    for (var filename of packFilenames) {
        if (!filename.startsWith(packagePath)) continue;
        var fileData = ns.read(filename) as string;

        if (filename === `${packagePath}package.txt`) {
            var metadata: BitpackMetadata = JSON.parse(fileData);
            delete metadata.publishKey;
            fileData = JSON.stringify(metadata, undefined, 4);
        }

        var packagePathNoLeadingSlash = packagePath.startsWith('/') ? packagePath.slice(1) : packagePath;
        var regexString = `import([^'"]+)(?=\\s*from)\\s*from\\s*(['"])\/*${packagePathNoLeadingSlash}(.*)(['"])`;
        var regex = RegExp(regexString, 'gm');
        if (filename.endsWith('.js') || filename.endsWith('.ns') || filename.endsWith('.script')) {
            fileData = fileData.replaceAll(regex, `import$1from $2/bitpacks/${packMetadata.uniqueName}/$3$4;`);
        }
        packFiles[filename.replace(packagePath, '')] = Compress(fileData);
    }

    var pack: BitpackPublishRequest = {
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
    var uploadResultOp = new Promise<boolean>((resolve, reject) => {
        xhr.onreadystatechange = () => {
            if (xhr.readyState === XMLHttpRequest.DONE) {
                if (xhr.responseText === '' || !xhr.responseText) {
                    error = 'Service unreachable.';
                    resolve(false);
                    return;
                }

                var response: BitpackPublishResponse;
                try {
                    response = JSON.parse(xhr.responseText);
                    if (response.error) {
                        error = response.error;
                        resolve(false);
                    } else {
                        version = response.version as number;
                        resolve(true);
                    }
                } catch (syntaxError) {
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
    if (result) Print(ns, options, `${packMetadata.uniqueName}:${version} published`);
    else PrintError(ns, error);
    return result;
}

function Manual(ns: NS, options: CommandOptions, bitpack: string) {
    if (!BitpackIsInstalled(ns, options, bitpack)) {
        Print(ns, options, `${bitpack} is not installed`);
        return;
    }

    var manual = ns.read(`/bitpacks/${bitpack}/manual.txt`);
    if (manual === '') Print(ns, options, `No manual found for ${bitpack}`);
    Print(ns, options, `\n${manual}`);
}

async function DownloadBitpack(ns: NS, options: CommandOptions, bitpack: string, version: string): Promise<BitpackMetadata | null> {
    var downloadResultOp = new Promise<Bitpack | null>((resolve, reject) => {
        var xhr = new XMLHttpRequest();
        var apiKey = 'AIzaSyAdqErjegWi8CFRMfrCFNn6Wf9GmR1kBl0';
        var doc = `bitpacks/${bitpack}%3A${version}`;
        var url = `https://firestore.googleapis.com/v1beta1/projects/bit-packer/databases/(default)/documents/${doc}?key=${apiKey}`;
        xhr.onreadystatechange = function () {
            if (xhr.readyState == XMLHttpRequest.DONE) {
                var responseJson: any = null;
                try {
                    responseJson = JSON.parse(xhr.responseText);
                    if (responseJson.error) resolve(null);
                    else {
                        resolve(ConvertFirestoreObject(responseJson).fields);
                    }
                } catch (syntaxError) {
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
        await ns.write(`/bitpacks/${bitpack}/${filename}`, Decompress(payload.files[filename]), 'w');
    }

    Print(ns, options, `Bitpack installed ${bitpack}:${payload.metadata.version}`);
    return payload.metadata;
}

async function ListBitpacks(ns: NS, options: CommandOptions) {
    var downloadResultOp = new Promise<BitpackRegistry[] | null>((resolve, reject) => {
        var xhr = new XMLHttpRequest();
        var apiKey = 'AIzaSyAdqErjegWi8CFRMfrCFNn6Wf9GmR1kBl0';
        var url = `https://firestore.googleapis.com/v1/projects/bit-packer/databases/(default)/documents/bitpack-registry?key=${apiKey}`;
        xhr.onreadystatechange = function () {
            if (xhr.readyState == XMLHttpRequest.DONE) {
                var responseJson: any = null;
                try {
                    responseJson = JSON.parse(xhr.responseText);
                    if (responseJson.error) {
                        ns.tprint(responseJson.error);
                        resolve(null);
                    } else {
                        var docs = [];
                        for (var docIndex in responseJson.documents) {
                            var doc = responseJson.documents[docIndex];
                            docs.push(ConvertFirestoreObject(doc.fields));
                        }
                        resolve(docs);
                    }
                } catch (syntaxError) {
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
    } else PrintError(ns, `Failed to fetch registry`);
}

function DeleteBitpack(ns: NS, options: CommandOptions, bitpack: string) {
    var files = ns.ls(ns.getHostname(), `/bitpacks/${bitpack}`);
    for (var file of files) {
        if (!file.startsWith(`/bitpacks/${bitpack}`)) continue;
        if (options.verbose) Print(ns, options, `Deleting ${file}`);
        ns.rm(file);
    }
}

function DeleteAllBitpacks(ns: NS, options: CommandOptions) {
    var files = ns.ls(ns.getHostname(), '/bitpacks/');
    for (var file of files) {
        if (!file.startsWith('/bitpacks/')) continue;
        if (file.startsWith(`/bitpacks/bp.js`)) continue;
        if (options.verbose) Print(ns, options, `Deleting ${file}`);
        ns.rm(file);
    }
}

function LoadManifest(ns: NS): BitpackManifest | null | undefined {
    var manifestJSON = ns.read('packages.txt');
    if (manifestJSON === '') return undefined;
    var manifest: BitpackManifest | null = null;
    try {
        manifest = JSON.parse(manifestJSON);
    } catch (syntaxError) {
        PrintError(ns, `Couldn't parse packages.txt\n\n${syntaxError}`);
    }
    return manifest;
}

async function CreateManifest(ns: NS): Promise<BitpackManifest> {
    var manifest: BitpackManifest = {
        bitpacks: {}
    };
    await SaveManifest(ns, manifest);
    return manifest;
}

async function SaveManifest(ns: NS, manifest: BitpackManifest) {
    var manifestJSON = JSON.stringify(manifest, undefined, 4);
    await ns.write('packages.txt', manifestJSON, 'w');
}

async function RequireManifest(ns: NS): Promise<BitpackManifest | null | undefined> {
    var manifest = LoadManifest(ns);
    if (!manifest) PrintError(ns, `package.txt not found`);
    return manifest;
}

function LoadMetadata(ns: NS, path: string): BitpackMetadata | null {
    var metadataJSON = ns.read(path);
    if (metadataJSON === '') return null;

    var metadata: BitpackMetadata | null = null;
    try {
        metadata = JSON.parse(metadataJSON) as BitpackMetadata;
    } catch (syntaxError) {
        PrintError(ns, `Couldn't parse package.txt:\n\n${syntaxError}`);
        return null;
    }

    return metadata;
}

function CheckRunning(ns: NS, options: CommandOptions) {
    var running = ns.ps();
    if (running.length > 1) Print(ns, options, `Detected running scripts. It's recommended to kill all scripts before running bitpack.`);
}

async function CheckUpdate(ns: NS, options: CommandOptions) {
    if (await ns.wget(BitpackerURL, '/bitpacks/bp_check.js')) {
        var newData = ns.read('/bitpacks/bp_check.js');
        var oldData = ns.read('/bitpacks/bp.js');
        ns.rm('/bitpacker/bp_check.js', ns.getHostname());
        if (newData !== oldData) Print(ns, options, `A new version of bitpacker is available. Run 'bp update-bp' to upgrade.`);
    }
}

function Print(ns: NS, options: CommandOptions, value: string) {
    if (options.quiet) return;
    ns.tprint(value);
}

function PrintError(ns: NS, value: string) {
    ns.tprint(`BITPACK ERROR: ${value}`);
}

function GetFirestoreProperty(value: any) {
    const props: any = {
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

function ConvertFirestoreObject(json: any): any {
    const prop = GetFirestoreProperty(json);
    if (prop === 'doubleValue' || prop === 'integerValue') {
        json = Number(json[prop]);
    } else if (prop === 'arrayValue') {
        json = ((json[prop] && json[prop].values) || []).map((v: any) => ConvertFirestoreObject(v));
    } else if (prop === 'mapValue') {
        json = ConvertFirestoreObject((json[prop] && json[prop].fields) || {});
    } else if (prop === 'geoPointValue') {
        json = { latitude: 0, longitude: 0, ...json[prop] };
    } else if (prop) {
        json = json[prop];
    } else if (typeof json === 'object') {
        Object.keys(json).forEach((k) => (json[k] = ConvertFirestoreObject(json[k])));
    }
    return json;
}

export function Compress(c: string) {
    var x: any = 'charCodeAt',
        b: any,
        e: any = {},
        f: any = c.split(''),
        d: any = [],
        a: any = f[0],
        g: any = 256;
    for (b = 1; b < f.length; b++) (c = f[b]), null != e[a + c] ? (a += c) : (d.push(1 < a.length ? e[a] : a[x](0)), (e[a + c] = g), g++, (a = c));
    d.push(1 < a.length ? e[a] : a[x](0));
    for (b = 0; b < d.length; b++) d[b] = String.fromCharCode(d[b]);
    return d.join('');
}

export function Decompress(b: string) {
    var bb: any = b;
    var a: any,
        e: any = {},
        d: any = b.split(''),
        c: any = d[0],
        f: any = c,
        g: any = [c],
        h: any = 256,
        o: any = h;
    for (bb = 1; bb < d.length; bb++) (a = d[bb].charCodeAt(0)), (a = h > a ? d[bb] : e[a] ? e[a] : f + c), g.push(a), (c = a.charAt(0)), (e[o] = f + c), o++, (f = a);
    return g.join('');
}
