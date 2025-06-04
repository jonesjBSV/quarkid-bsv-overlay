import {
  LookupService,
  LookupQuestion,
  LookupAnswer,
  LookupFormula,
} from '@bsv/overlay'
import { Script, Utils } from '@bsv/sdk'
import { Db } from 'mongodb'
import { QuarkIdDidStorage } from './QuarkIdDidStorage.js'
import {
  DidPayload,
  CreateDidPayload,
  UpdateDidPayload,
  RevokeDidPayload,
  DidDocument,
  CachedDidState,
  OutputInformation, // Ensured OutputInformation is here
  QuarkIdDidLookupServiceAdditionalDataOutputAdded,
  QuarkIdDidLookupServiceAdditionalDataOutputDeleted,
} from '../types.js'

const DID_TOPIC_NAME = 'tm_qdid' // Must match the topic name in TopicManager
const DID_METHOD_PREFIX = `did:bsv-overlay:${DID_TOPIC_NAME}`
const SERVICE_ID = 'ls_qdid' // Unique service ID for this lookup service

// Placeholder for documentation - replace with actual content or import
const docs = `
# QuarkID DID Lookup Service (ls_qdid)

This service resolves DIDs managed by the 'tm_qdid' topic manager.

## Query Format
Queries should be the full DID identifier, e.g., "did:bsv-overlay:tm_qdid:txid:vout".

## Response Format
Returns a standard W3C DID Resolution result object.
`;

class QuarkIdDidLookupService implements LookupService {
  constructor(public storage: QuarkIdDidStorage) {}

  async outputAdded(
    txid: string, // This txid is from the output itself, not necessarily from additionalData.newUtxoInfo
    outputIndex: number,
    outputScript: Script,
    topic: string,
    additionalData?: QuarkIdDidLookupServiceAdditionalDataOutputAdded
  ): Promise<void> {
    if (topic !== DID_TOPIC_NAME || !additionalData) {
      console.log(`QuarkIdDidLookupService: outputAdded called for wrong topic (${topic}) or no additionalData. Ignoring.`)
      return
    }

    const { payload, newUtxoInfo, spentUtxoInfo } = additionalData;

    try {
      if (payload.operation === 'CREATE_DID') {
        // For CREATE, newUtxoInfo's txid and outputIndex should match the parameters txid and outputIndex
        if (newUtxoInfo.txid !== txid || newUtxoInfo.vout !== outputIndex) {
          console.error(`QuarkIdDidLookupService: Mismatch in CREATE_DID - UTXO params (${txid}:${outputIndex}) vs newUtxoInfo (${newUtxoInfo.txid}:${newUtxoInfo.vout}). Using newUtxoInfo.`);
        }
        await this.storage.storeNewDidState(newUtxoInfo, payload as CreateDidPayload);
        console.log(`QuarkIdDidLookupService: Stored new DID state for ${newUtxoInfo.txid}:${newUtxoInfo.vout}`);
      } else if (payload.operation === 'UPDATE_DID') {
        if (!spentUtxoInfo) {
          console.error('QuarkIdDidLookupService: UPDATE_DID operation missing spentUtxoInfo in additionalData. Ignoring.');
          return;
        }
        // For UPDATE, newUtxoInfo's txid and outputIndex should match the parameters txid and outputIndex
        if (newUtxoInfo.txid !== txid || newUtxoInfo.vout !== outputIndex) {
          console.error(`QuarkIdDidLookupService: Mismatch in UPDATE_DID - UTXO params (${txid}:${outputIndex}) vs newUtxoInfo (${newUtxoInfo.txid}:${newUtxoInfo.vout}). Using newUtxoInfo.`);
        }
        await this.storage.updateDidState(spentUtxoInfo, newUtxoInfo, payload as UpdateDidPayload);
        console.log(`QuarkIdDidLookupService: Updated DID state from ${spentUtxoInfo.txid}:${spentUtxoInfo.vout} to ${newUtxoInfo.txid}:${newUtxoInfo.vout}`);
      } else {
        console.warn(`QuarkIdDidLookupService: outputAdded called with unhandled operation '${(payload as any).operation}'. Ignoring.`);
      }
    } catch (error) {
      console.error('QuarkIdDidLookupService: Error processing outputAdded:', error);
    }
  }

  async outputDeleted(
    txid: string, // txid of the spent output
    outputIndex: number, // vout of the spent output
    topic: string,
    additionalData?: QuarkIdDidLookupServiceAdditionalDataOutputDeleted
  ): Promise<void> {
    if (topic !== DID_TOPIC_NAME || !additionalData) {
      console.log(`QuarkIdDidLookupService: outputDeleted called for wrong topic (${topic}) or no additionalData. Ignoring.`)
      return
    }

    const { payload, spentUtxoInfo } = additionalData;

    // Ensure spentUtxoInfo from additionalData matches the txid/outputIndex parameters
    if (spentUtxoInfo.txid !== txid || spentUtxoInfo.vout !== outputIndex) {
      console.error(`QuarkIdDidLookupService: Mismatch in REVOKE_DID - UTXO params (${txid}:${outputIndex}) vs spentUtxoInfo (${spentUtxoInfo.txid}:${spentUtxoInfo.vout}). Using spentUtxoInfo.`);
    }

    if (payload.operation === 'REVOKE_DID') {
      try {
        await this.storage.revokeDidState(spentUtxoInfo, payload as RevokeDidPayload);
        console.log(`QuarkIdDidLookupService: Revoked DID state for ${spentUtxoInfo.txid}:${spentUtxoInfo.vout}`);
      } catch (error) {
        console.error('QuarkIdDidLookupService: Error processing outputDeleted for REVOKE_DID:', error);
      }
    } else {
      console.warn(`QuarkIdDidLookupService: outputDeleted called with unhandled operation '${payload.operation}'. Ignoring.`);
    }
  }

  async lookup(question: LookupQuestion): Promise<LookupAnswer | LookupFormula> {
    if (question.type !== 'formula' || !question.value || typeof question.value !== 'string') {
      console.log('QuarkIdDidLookupService: Invalid question format for lookup.');
      return {
        type: 'answer',
        value: {
          didDocument: null,
          didDocumentMetadata: {},
          didResolutionMetadata: {
            contentType: 'application/did+json',
            retrieved: new Date().toISOString(),
            error: 'invalidDidUrl' // Indicates the provided DID (question.value) was not valid
          }
        }
      };
    }

    const didIdentifier = question.value;
    console.log(`QuarkIdDidLookupService: Received lookup for DID: ${didIdentifier}`);

    // Validate DID format (basic check)
    if (!didIdentifier.startsWith(DID_METHOD_PREFIX + ':')) {
      console.log(`QuarkIdDidLookupService: Invalid DID format for ${didIdentifier}.`);
      return {
        type: 'answer',
        value: {
          didDocument: null,
          didDocumentMetadata: {},
          didResolutionMetadata: {
            contentType: 'application/did+json',
            retrieved: new Date().toISOString(),
            error: 'invalidDid'
          }
        }
      };
    }

    const cachedState = await this.storage.getLiveDidState(didIdentifier);
    const overallStatus = await this.storage.getDidOverallStatus(didIdentifier);

    if (!cachedState || overallStatus === 'not_found') {
      console.log(`QuarkIdDidLookupService: DID ${didIdentifier} not found or no active state.`);
      return {
        type: 'answer',
        value: {
          didDocument: null,
          didDocumentMetadata: {},
          didResolutionMetadata: {
            contentType: 'application/did+json',
            retrieved: new Date().toISOString(),
            error: 'notFound'
          }
        }
      };
    }
    
    // Ensure the id property in the DID document matches the resolved DID identifier
    const didDocument = { ...cachedState.didDocument, id: didIdentifier };

    const resolutionResult = {
      didDocument: overallStatus === 'revoked' ? { ...didDocument, "deactivated": true } : didDocument,
      didDocumentMetadata: { 
        created: cachedState.createdAt,
        updated: cachedState.updatedAt,
        versionId: String(cachedState.version),
        deactivated: overallStatus === 'revoked',
        network: 'bsv-regtest', // TODO: Make this dynamic or configurable
        txid: cachedState.currentTxid,
        vout: cachedState.currentVout,
        controllerPublicKeyHex: cachedState.controller.publicKeyHex,
      },
      didResolutionMetadata: {
        contentType: 'application/did+json',
        retrieved: new Date().toISOString(),
        error: overallStatus === 'revoked' ? 'deactivated' : undefined
      }
    }
    
    console.log(`QuarkIdDidLookupService: Resolved DID ${didIdentifier} to state:`, resolutionResult);
    return {
      type: 'answer',
      value: resolutionResult
    };
  }

  async getDocumentation(): Promise<string> {
    return docs;
  }

  async getMetaData(): Promise<any> {
    return {
      name: 'QuarkID DID Lookup Service',
      shortDescription: 'Resolves DIDs for the "qdid" method on BSV Overlay.',
      serviceID: SERVICE_ID,
      version: '0.1.0',
    };
  }
}

export default (db: Db): QuarkIdDidLookupService => {
  const mongoStorage = new QuarkIdDidStorage(db);
  return new QuarkIdDidLookupService(mongoStorage);
};
