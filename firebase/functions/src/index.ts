import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { v4 as uuidv4 } from "uuid";
import * as yup from "yup";

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

export const UploadPackage = functions
    .runWith({
        memory: "128MB",
    })
    .https.onRequest(async (request, response) => {
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
            var bitpack = {
                metadata: { ...payload.metadata, version: publishedVersion },
                files: payload.files,
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
