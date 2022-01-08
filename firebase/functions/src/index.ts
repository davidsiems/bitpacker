import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { v4 as uuidv4 } from "uuid";

admin.initializeApp();
var firestore = admin.firestore();

interface BitpackMetadata {
    uniqueName: string;
    shortDescription: string;
    tags: string[];
    version: number;
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

interface BitpackCreateRequest {
    bitpack: string;
}

interface BitpackManifest {
    key: string;
    nextVersion: number;
}

export const UploadPackage = functions
    .runWith({
        memory: "128MB",
    })
    .https.onRequest(async (request, response) => {
        var payload = request.body as BitpackPublishRequest;
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

            return publishedVersion;
        });

        response.send({ ok: true, version });
    });

export const CreatePackage = functions
    .runWith({
        memory: "128MB",
    })
    .https.onRequest(async (request, response) => {
        var payload = request.body as BitpackCreateRequest;
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
