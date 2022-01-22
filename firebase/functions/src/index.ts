import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { v4 as uuidv4 } from "uuid";
import * as yup from "yup";
import * as zlib from "zlib";

admin.initializeApp();
var firestore = admin.firestore();

interface BitpackMetadata {
    uniqueName: string;
    shortDescription: string;
    tags: string[];
    version?: number;
    publishKey?: string;

    author?: string;
    descriptiveName?: string;
    longDescription?: string;
    aliases?: Record<string, string>;
}

var BitpackTags: string[] = [
    "os",
    "utility",
    "fun",
    "ui",
    "qol",
    "library",
    "terminal",
    "ns2",
    "ns1",
];

var PublishRequestSchema = yup.object().shape({
    metadata: yup
        .object()
        .shape({
            uniqueName: yup
                .string()
                .min(2, "uniqueName must be at least 2 characters.")
                .max(64, "uniqueName cannot be longer than 64 characters.")
                .required("Missing uniqueName field."),
            shortDescription: yup
                .string()
                .min(1, "shortDescription must be at least 1 character.")
                .max(
                    120,
                    "Short description cannot be longer than 120 characters."
                )
                .required("Missing shortDescription field."),
            tags: yup
                .array()
                .of(yup.string().oneOf([...BitpackTags]))
                .required("Missing tags field."),
            author: yup
                .string()
                .max(64, "author cannot be longer than 64 characters.")
                .optional(),
            descriptiveName: yup
                .string()
                .max(64, "descriptiveName cannot be longer than 64 characters.")
                .optional(),
            longDescription: yup
                .string()
                .max(
                    512,
                    "longDescription cannot be longer than 512 characters."
                )
                .optional(),
            aliases: yup.lazy((value) => {
                var schema = yup.object().optional();
                switch (typeof value) {
                    case "object": {
                        for (var key in value) {
                            if (typeof key !== "string") continue;
                            var field: any = {};
                            var regex = new RegExp("^.+.[js|ns|script]+$");
                            field[key] = yup.string().matches(regex).required();
                            schema = schema.shape(field);
                        }
                        break;
                    }
                }
                return schema;
            }),
        })
        .required("Missing metadata field."),
    files: yup.lazy((value) => {
        var schema = yup.object().required("Missing files field");
        switch (typeof value) {
            case "object": {
                for (var key in value) {
                    if (typeof key !== "string") continue;
                    if (
                        !key.endsWith(".txt") &&
                        !key.endsWith(".script") &&
                        !key.endsWith(".js") &&
                        !key.endsWith(".ns")
                    )
                        continue;

                    var field: any = {};
                    field[key] = yup.string().required();
                    schema = schema.shape(field);
                }
                break;
            }
        }
        return schema;
    }),
    key: yup.string().required(),
});

interface BitpackPublishRequest {
    metadata: BitpackMetadata;
    files: Record<string, string>;
    key: string;
}

var CreateRequestSchema = yup.object().shape({
    bitpack: yup
        .string()
        .min(2, "bitpack must be at least 2 characters.")
        .max(64, "bitpack cannot be longer than 64 characters.")
        .required("Missing bitpack field"),
});

interface BitpackCreateRequest {
    bitpack: string;
}

var DownloadRequestScheme = yup.object().shape({
    bitpack: yup
        .string()
        .min(2, "bitpack must be at least 2 characters.")
        .max(64, "bitpack cannot be longer than 64 characters.")
        .required("Missing bitpack field"),
    version: yup.string().required(),
});

interface BitpackDownloadRequest {
    bitpack: string;
    version: string;
}

interface BitpackManifest {
    key: string;
    nextVersion: number;
}

interface BitpackRegistry {
    uniqueName: string;
    shortDescription: string;
    author?: string;
    tags: string[];
}

interface Bitpack {
    metadata: BitpackMetadata;
    files: Record<string, string>;
    legacyCompression?: boolean;
}

export const UploadPackage = functions
    .runWith({
        memory: "128MB",
    })
    .https.onRequest(async (request, response) => {
        response.set("Access-Control-Allow-Origin", "*");
        if (request.method === "OPTIONS") {
            response.set("Access-Control-Allow-Methods", "POST");
            response.set("Access-Control-Allow-Headers", "Content-Type");
            response.set("Access-Control-Max-Age", "3600");
            response.status(204).send("");
            return;
        }

        var payload: BitpackPublishRequest;
        try {
            payload = (await PublishRequestSchema.validate(request.body, {
                stripUnknown: true,
            })) as BitpackPublishRequest;
        } catch (error) {
            response.send({ error: (error as any).message });
            return;
        }

        var manifestCollection = firestore.collection("bitpack-manifests");
        var manifestDocRef = manifestCollection.doc(
            payload.metadata.uniqueName
        );
        var manifestDoc = await manifestDocRef.get();
        if (!manifestDoc.exists) {
            response.send({
                error: `Bitpack ${payload.metadata.uniqueName} not registered.`,
            });
            return;
        }

        var manifest = manifestDoc.data() as BitpackManifest;
        if (manifest.key !== payload.key) {
            response.send({
                error: `Unauthorized. Your publish key does not have permission to publish to ${payload.metadata.uniqueName}`,
            });
            return;
        }

        var registryCollection = firestore.collection("bitpack-registry");
        var registryDocRef = registryCollection.doc(
            payload.metadata.uniqueName
        );

        var compressedFiles: Record<string, string> = {};
        for (var file in payload.files) {
            compressedFiles[file] = zlib
                .deflateSync(payload.files[file], {
                    level: zlib.constants.Z_BEST_COMPRESSION,
                })
                .toString("base64");
        }

        var version = await firestore.runTransaction(async (t) => {
            var manifestDoc = await t.get(manifestDocRef);
            var manifest = manifestDoc.data() as BitpackManifest;

            var bitpackCollection = firestore.collection("bitpacks");
            var bitpackDoc = bitpackCollection.doc(
                `${payload.metadata.uniqueName}:${manifest.nextVersion}`
            );
            var bitpackLatestDoc = bitpackCollection.doc(
                `${payload.metadata.uniqueName}:latest`
            );

            var publishedVersion = manifest.nextVersion;
            var bitpack: Bitpack = {
                metadata: { ...payload.metadata, version: publishedVersion },
                files: compressedFiles,
            };

            t.set(bitpackDoc, bitpack);
            t.set(bitpackLatestDoc, bitpack);

            var nextVersion = manifest.nextVersion + 1;
            t.update(manifestDocRef, {
                nextVersion: nextVersion,
            });

            var registry: BitpackRegistry = {
                uniqueName: payload.metadata.uniqueName,
                shortDescription: payload.metadata.shortDescription,
                author: payload.metadata.author,
                tags: payload.metadata.tags,
            };
            t.set(registryDocRef, registry);

            return publishedVersion;
        });

        response.send({ ok: true, version });
    });

export const CreatePackage = functions
    .runWith({
        memory: "128MB",
    })
    .https.onRequest(async (request, response) => {
        response.set("Access-Control-Allow-Origin", "*");
        if (request.method === "OPTIONS") {
            response.set("Access-Control-Allow-Methods", "POST");
            response.set("Access-Control-Allow-Headers", "Content-Type");
            response.set("Access-Control-Max-Age", "3600");
            response.status(204).send("");
            return;
        }

        var payload: BitpackCreateRequest;
        try {
            payload = (await CreateRequestSchema.validate(request.body, {
                stripUnknown: true,
            })) as BitpackCreateRequest;
        } catch (error) {
            response.send({ error: (error as any).message });
            return;
        }

        var manifestCollection = firestore.collection("bitpack-manifests");
        var manifestDocRef = manifestCollection.doc(payload.bitpack);

        var publishKey = await firestore.runTransaction(async (t) => {
            var manifestDoc = await t.get(manifestDocRef);
            if (manifestDoc.exists) return "";

            var key = uuidv4().replace("-", "");
            var newManifest: BitpackManifest = {
                key: key,
                nextVersion: 1,
            };
            t.set(manifestDocRef, newManifest);

            return key;
        });

        if (publishKey === "") {
            response.send({
                error: `${payload.bitpack} already exists. Please choose a different name.`,
            });
        } else {
            response.send({ ok: true, key: publishKey });
        }
    });

export const DownloadPackage = functions
    .runWith({
        memory: "128MB",
    })
    .https.onRequest(async (request, response) => {
        response.set("Access-Control-Allow-Origin", "*");
        if (request.method === "OPTIONS") {
            response.set("Access-Control-Allow-Methods", "POST");
            response.set("Access-Control-Allow-Headers", "Content-Type");
            response.set("Access-Control-Max-Age", "3600");
            response.status(204).send("");
            return;
        }

        var payload: BitpackDownloadRequest;
        try {
            payload = (await DownloadRequestScheme.validate(request.body, {
                stripUnknown: true,
            })) as BitpackDownloadRequest;
        } catch (error) {
            response.send({ error: (error as any).message });
            return;
        }

        var bitpackCollection = firestore.collection("bitpacks");
        var bitpackDocRef = bitpackCollection.doc(
            `${payload.bitpack}:${payload.version}`
        );
        var bitpackDoc = await bitpackDocRef.get();
        if (!bitpackDoc.exists) {
            response.send({
                error: `${payload.bitpack}:${payload.version} not found.`,
            });
            return;
        }

        var bitpack = bitpackDoc.data() as Bitpack;
        if (bitpack.legacyCompression) {
            for (var file in bitpack.files) {
                bitpack.files[file] = Decompress_v1(bitpack.files[file]);
            }
        } else {
            for (var file in bitpack.files) {
                bitpack.files[file] = zlib
                    .inflateSync(Buffer.from(bitpack.files[file], "base64"))
                    .toString();
            }
        }

        response.send({ ok: true, bitpack });
    });

export function Decompress_v1(b: string) {
    var bb: any = b;
    var a: any,
        e: any = {},
        d: any = b.split(""),
        c: any = d[0],
        f: any = c,
        g: any = [c],
        h: any = 256,
        o: any = h;
    for (bb = 1; bb < d.length; bb++)
        (a = d[bb].charCodeAt(0)),
            (a = h > a ? d[bb] : e[a] ? e[a] : f + c),
            g.push(a),
            (c = a.charAt(0)),
            (e[o] = f + c),
            o++,
            (f = a);
    return g.join("");
}
