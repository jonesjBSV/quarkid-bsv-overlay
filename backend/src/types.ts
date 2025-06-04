// Generic UTXO Reference

export interface OutputInformation {
  txid: string;
  vout: number;
  scriptHex: string; // Hex string of the script (as created by TopicManager)
  satoshis: number;
}

export interface UTXOReference {
  txid: string;
  outputIndex: number; // Note: bsv/overlay OutputInformation uses 'vout'
}

// DID System Specific Types

export interface Controller {
  publicKeyHex: string; // The public key (hex string) that controls this DID state
}

export interface VerificationMethod {
  id: string; // e.g., did:example:123#keys-1
  type: string; // e.g., Ed25519VerificationKey2020
  controller: string; // The DID that controls this verification method
  publicKeyHex?: string; // The public key in hex format
}

export interface ServiceEndpoint {
  id: string; // e.g., did:example:123#service-1
  type: string; // e.g., MyCustomServiceType
  serviceEndpoint: string | object; // URL or structured data representing the service endpoint
}

export interface DidDocument {
  '@context'?: string | string[]; // URI(s) defining the JSON-LD context
  id: string; // The DID identifier itself, e.g., did:qdid:txid:vout
  verificationMethod?: VerificationMethod[];
  authentication?: (string | VerificationMethod)[]; // Used for authentication
  assertionMethod?: (string | VerificationMethod)[]; // Used for issuing verifiable credentials
  keyAgreement?: (string | VerificationMethod)[]; // Used for cryptographic key agreement
  capabilityInvocation?: (string | VerificationMethod)[]; // Used for invoking capabilities
  capabilityDelegation?: (string | VerificationMethod)[]; // Used for delegating capabilities
  service?: ServiceEndpoint[]; // Service endpoints associated with the DID
  created?: string; // ISO datetime string of when the DID document was created
  updated?: string; // ISO datetime string of when the DID document was last updated
}

export interface CachedDidState {
  _id?: any; // For MongoDB's internal _id, optional during creation
  didIdentifier: string; // The unique DID, e.g., did:qdid:txid:vout
  currentTxid: string;   // TXID of the UTXO representing this state
  currentVout: number;   // Vout of the UTXO representing this state
  didDocument: DidDocument; // The DID Document associated with this state
  controller: Controller;   // The controller (e.g., public key) of this specific DID state
  status: 'active' | 'superseded' | 'revoked'; // Status of this specific UTXO state
  version: number;        // Version number of the DID state
  createdAt: string;      // ISO datetime string of when this state was first created
  updatedAt?: string;     // ISO datetime string of the last update to this state
  history?: Array<{        // Optional history of transactions affecting this DID
    txid: string;
    vout: number;
    operation: 'CREATE_DID' | 'UPDATE_DID' | 'REVOKE_DID';
    timestamp?: string;   // ISO datetime string
  }>;
}

export interface DidIdentifierToLiveStateIndex {
  // _id in MongoDB will be the didIdentifier string
  currentTxid: string;   // TXID of the current live UTXO for the DID
  currentVout: number;   // Vout of the current live UTXO for the DID
  status: 'active' | 'revoked'; // Overall status of the DID identifier
}

// Payloads for Topic Manager & Storage interactions

// Import OutputInformation if it's used by additionalData types and not globally available
// Assuming OutputInformation is defined in or imported from '@bsv/overlay'
// OutputInformation is now defined above in this file.


export interface QuarkIdDidLookupServiceAdditionalDataOutputAdded {
  payload: CreateDidPayload | UpdateDidPayload; // TopicManager determines this
  newUtxoInfo: OutputInformation;       // Info about the new state UTXO from @bsv/overlay OutputInformation
  spentUtxoInfo?: OutputInformation;      // Info about the old state UTXO (for UPDATE) from @bsv/overlay OutputInformation
}

export interface QuarkIdDidLookupServiceAdditionalDataOutputDeleted {
  payload: RevokeDidPayload;            // Payload from the spending transaction
  spentUtxoInfo: OutputInformation;       // Info about the UTXO that was spent from @bsv/overlay OutputInformation
}

export interface CreateDidPayload {
  didDocument: Partial<Omit<DidDocument, 'id' | 'created' | 'updated'>>;
  controller: Controller; 
  // Base DidPayload properties
  operation: 'CREATE_DID';
  protocolVersion?: '1.0'; // Optional if always '1.0'
  topic?: 'qdid';          // Optional if always 'qdid'
}

export interface UpdateDidPayload {
  newDidDocument?: Partial<Omit<DidDocument, 'id' | 'created' | 'updated'>>;
  didDocumentChanges?: Partial<Omit<DidDocument, 'id' | 'created' | 'updated'>>;
  newController?: Controller; 
  // Base DidPayload properties
  operation: 'UPDATE_DID';
  protocolVersion?: '1.0';
  topic?: 'qdid';
  // Identifying the state to update (if not implicit from spent UTXO)
  didState?: { txid: string; vout: number; }; 
}

export interface RevokeDidPayload {
  reason?: string; 
  // Base DidPayload properties
  operation: 'REVOKE_DID';
  protocolVersion?: '1.0';
  topic?: 'qdid';
  // Identifying the state to revoke (if not implicit from spent UTXO)
  didState?: { txid: string; vout: number; };
}

export type DidPayload = CreateDidPayload | UpdateDidPayload | RevokeDidPayload;

// Meter System Specific Types
export interface MeterRecord {
  _id?: any; // For MongoDB's internal _id
  txid: string;
  outputIndex: number;
  value: number; // The meter reading or value
  creatorIdentityKey: string; // Public key of the meter creator/owner
  createdAt: Date; // Timestamp of when the record was created
}