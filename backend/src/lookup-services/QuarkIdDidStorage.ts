// bsv-overlay-example/backend/src/lookup-services/QuarkIdDidStorage.ts
import {
  CachedDidState,
  DidIdentifierToLiveStateIndex,
  DidDocument,
  Controller,
  CreateDidPayload,
  UpdateDidPayload,
  RevokeDidPayload,
  OutputInformation // OutputInformation comes from types.ts
} from '../types.js'
import { Collection, Db, WithId } from 'mongodb'

const DID_TOPIC_NAME = 'tm_qdid' // Standardized topic name
const DID_METHOD_PREFIX = `did:bsv-overlay:${DID_TOPIC_NAME}`

export class QuarkIdDidStorage {
  private readonly didCachedStatesCollection: Collection<CachedDidState>;
  private readonly didLiveIndexCollection: Collection<WithId<DidIdentifierToLiveStateIndex>>; // _id will be didIdentifier

  constructor(private db: Db) {
    this.didCachedStatesCollection = db.collection<CachedDidState>('didCachedStates');
    this.didLiveIndexCollection = db.collection<WithId<DidIdentifierToLiveStateIndex>>('didLiveIndex');
    console.log('QuarkIdDidStorage initialized with MongoDB collections (didCachedStates, didLiveIndex).');

    // Consider creating indexes for faster queries if they don't exist.
    // This should ideally be done once, perhaps outside the constructor or checked.
    // this.didCachedStatesCollection.createIndex({ currentTxid: 1, currentVout: 1 }, { unique: true });
    // this.didCachedStatesCollection.createIndex({ didIdentifier: 1 });
    // this.didLiveIndexCollection.createIndex({ _id: 1 }); // _id is already indexed by MongoDB
  }

  async storeNewDidState(
    newUtxoInfo: OutputInformation,
    payload: CreateDidPayload
  ): Promise<CachedDidState | null> {
    const { txid: currentTxid, vout: currentVout } = newUtxoInfo;
    const didIdentifier = `${DID_METHOD_PREFIX}:${currentTxid}:${currentVout}`;
    const now = new Date().toISOString();

    const existingState = await this.didCachedStatesCollection.findOne({ currentTxid, currentVout });
    if (existingState) {
      console.warn(`Storage: Attempted to store new DID state for existing UTXO ${currentTxid}:${currentVout}. Ignoring.`);
      return existingState;
    }

    const newCachedState: CachedDidState = {
      didIdentifier,
      didDocument: payload.didDocument,
      controller: payload.controller,
      status: 'active',
      version: 1,
      createdAt: now,
      updatedAt: now,
      currentTxid,
      currentVout,
      scriptHex: newUtxoInfo.scriptHex,
      satoshis: newUtxoInfo.satoshis
    };

    await this.didCachedStatesCollection.insertOne(newCachedState);
    console.log(`Storage: Inserted new cached state for DID ${didIdentifier} at UTXO ${currentTxid}:${currentVout}.`);

    const newLiveIndexEntry: DidIdentifierToLiveStateIndex = {
      // _id: didIdentifier, // MongoDB will generate _id if not provided, or use if provided.
      // For this collection, we want _id to be the didIdentifier for easy lookup.
      currentTxid,
      currentVout,
      status: 'active'
    };
    await this.didLiveIndexCollection.updateOne(
      { _id: didIdentifier }, 
      { $set: newLiveIndexEntry }, 
      { upsert: true }
    );
    console.log(`Storage: Upserted live index for DID ${didIdentifier} to point to UTXO ${currentTxid}:${currentVout}.`);

    return newCachedState;
  }

  async updateDidState(
    spentUtxoInfo: OutputInformation,
    newUtxoInfo: OutputInformation,
    payload: UpdateDidPayload
  ): Promise<CachedDidState | null> {
    const { txid: spentTxid, vout: spentVout } = spentUtxoInfo;
    const { txid: newTxid, vout: newVout } = newUtxoInfo;
    const now = new Date().toISOString();

    const oldState = await this.didCachedStatesCollection.findOne({ currentTxid: spentTxid, currentVout: spentVout });
    if (!oldState) {
      console.error(`Storage: Cannot update. Old state for UTXO ${spentTxid}:${spentVout} not found.`);
      return null;
    }
    if (oldState.status !== 'active') {
      console.warn(`Storage: Attempted to update a non-active state (${oldState.status}) for UTXO ${spentTxid}:${spentVout}.`);
      // Depending on rules, might allow updating a superseded state if it's a reorg correction, but typically not.
      // For now, let's be strict.
      return null;
    }

    // Mark the old state as superseded
    await this.didCachedStatesCollection.updateOne(
      { currentTxid: spentTxid, currentVout: spentVout },
      { $set: { status: 'superseded', updatedAt: now } }
    );
    console.log(`Storage: Marked old state at UTXO ${spentTxid}:${spentVout} as superseded.`);

    const didIdentifier = oldState.didIdentifier; // The DID identifier remains the same

    const newCachedState: CachedDidState = {
      didIdentifier,
      didDocument: payload.didDocument || oldState.didDocument, // Allow partial updates to document
      controller: payload.newController,
      status: 'active',
      version: oldState.version + 1,
      createdAt: oldState.createdAt, // Original creation time
      updatedAt: now,
      currentTxid: newTxid,
      currentVout: newVout,
      scriptHex: newUtxoInfo.scriptHex,
      satoshis: newUtxoInfo.satoshis
    };

    await this.didCachedStatesCollection.insertOne(newCachedState);
    console.log(`Storage: Inserted new cached state for updated DID ${didIdentifier} at UTXO ${newTxid}:${newVout}.`);

    // Update the live index to point to the new state UTXO
    const updatedLiveIndexEntry: Partial<DidIdentifierToLiveStateIndex> = {
      currentTxid: newTxid,
      currentVout: newVout,
      status: 'active' // Ensure status is active
    };
    await this.didLiveIndexCollection.updateOne(
      { _id: didIdentifier }, 
      { $set: updatedLiveIndexEntry }
      // No upsert here, as the index must exist for an update
    );
    console.log(`Storage: Updated live index for DID ${didIdentifier} to point to new UTXO ${newTxid}:${newVout}.`);

    return newCachedState;
  }

  async revokeDidState(
    spentUtxoInfo: OutputInformation,
    payload: RevokeDidPayload
  ): Promise<CachedDidState | null> {
    const { txid: spentTxid, vout: spentVout } = spentUtxoInfo;
    const now = new Date().toISOString();

    const stateToRevoke = await this.didCachedStatesCollection.findOne({ currentTxid: spentTxid, currentVout: spentVout });
    if (!stateToRevoke) {
      console.error(`Storage: Cannot revoke. State for UTXO ${spentTxid}:${spentVout} not found.`);
      return null;
    }
    if (stateToRevoke.status !== 'active') {
      console.warn(`Storage: Attempted to revoke a non-active state (${stateToRevoke.status}) for UTXO ${spentTxid}:${spentVout}.`);
      return null;
    }

    // Mark the specific UTXO state as revoked
    await this.didCachedStatesCollection.updateOne(
      { currentTxid: spentTxid, currentVout: spentVout },
      { $set: { status: 'revoked', updatedAt: now } }
    );
    console.log(`Storage: Marked state at UTXO ${spentTxid}:${spentVout} as revoked.`);

    const didIdentifier = stateToRevoke.didIdentifier;

    // Update the live index to mark the entire DID as revoked
    const revokedLiveIndexEntry: Partial<DidIdentifierToLiveStateIndex> = {
      status: 'revoked'
      // currentTxid and currentVout in the index might still point to the last known UTXO,
      // but the status 'revoked' takes precedence.
    };
    await this.didLiveIndexCollection.updateOne(
      { _id: didIdentifier }, 
      { $set: revokedLiveIndexEntry }
    );
    console.log(`Storage: Updated live index for DID ${didIdentifier} to status 'revoked'.`);

    return { ...stateToRevoke, status: 'revoked', updatedAt: now };
  }

  async getLiveDidState(didIdentifier: string): Promise<CachedDidState | null> {
    const liveStateRef = await this.didLiveIndexCollection.findOne({ _id: didIdentifier });
    if (!liveStateRef) {
      console.log(`Storage: DID identifier ${didIdentifier} not found in live index.`);
      return null;
    }

    // If the DID itself is marked revoked in the index, we might return the state
    // but its status should reflect the overall DID status.
    const cachedState = await this.didCachedStatesCollection.findOne({ 
      currentTxid: liveStateRef.currentTxid, 
      currentVout: liveStateRef.currentVout 
    });

    if (!cachedState) {
      console.error(`Storage: Indexed state for DID ${didIdentifier} (pointing to UTXO ${liveStateRef.currentTxid}:${liveStateRef.currentVout}) not found in cached states. Index/State mismatch possible.`);
      return null; 
    }
    
    return cachedState;
  }

  async getDidOverallStatus(didIdentifier: string): Promise<'active' | 'revoked' | 'not_found'> {
    const liveStateRef = await this.didLiveIndexCollection.findOne({ _id: didIdentifier });
    if (!liveStateRef) {
      return 'not_found';
    }
    return liveStateRef.status; // status comes from DidIdentifierToLiveStateIndex
  }

  async getControllerForUtxo(txid: string, vout: number): Promise<Controller | null> {
    const state = await this.didCachedStatesCollection.findOne({ currentTxid: txid, currentVout: vout });
    return state && state.status === 'active' ? state.controller : null;
  }
}
