// bsv-overlay-example/backend/src/topic-managers/QuarkIdDidTopicManager.ts
import { AdmittanceInstructions, TopicManager } from '@bsv/overlay'
import { Transaction as SdkTransaction, Script, P2PKH, PublicKey, Utils, Output as SDKOutput } from '@bsv/sdk'
import {
  DidPayload,
  CreateDidPayload,
  UpdateDidPayload,
  RevokeDidPayload,
  OutputInformation,
  QuarkIdDidLookupServiceAdditionalDataOutputAdded,
  QuarkIdDidLookupServiceAdditionalDataOutputDeleted
} from '../types.js'
import { QuarkIdDidStorage } from '../lookup-services/QuarkIdDidStorage.js'

const docs = `
# QuarkID DID Topic Manager (tm_qdid)

Manages transactions related to the 'tm_qdid' (QuarkID DID) method.
- CREATE_DID: Validates and admits the initial P2PKH state UTXO.
- UPDATE_DID: Validates the spend of the old state UTXO, and admits the new P2PKH state UTXO.
- REVOKE_DID: Validates the spend of the state UTXO to revoke the DID.
Off-chain DidPayload must be provided during submission.
`

const DID_TOPIC_NAME = 'tm_qdid'
const MIN_STATE_UTXO_SATOSHIS = 1 // Minimum satoshis for a P2PKH state UTXO
const DEFAULT_STATE_UTXO_VOUT = 0 // Assuming the state UTXO is typically the first output

export class QuarkIdDidTopicManager implements TopicManager {
  private currentDidPayload: DidPayload | null = null

  constructor(private storage: QuarkIdDidStorage) {}

  // Helper to simulate payload association. In a real system, this might be part of the Engine or submission process.
  public setCurrentPayloadForTransaction(payload: DidPayload | null): void {
    this.currentDidPayload = payload;
  }

  private clearCurrentPayload(): void {
    this.currentDidPayload = null;
  }

  // Placeholder for actual signature verification logic
  // This needs to be implemented robustly based on your DID method's security model.
  private async verifyControllerSignature(
    transaction: SdkTransaction,
    inputIndex: number,
    spentTxid: string,
    spentVout: number,
    controllerPublicKeyHex: string
  ): Promise<boolean> {
    // TODO: Implement actual signature verification using @bsv/sdk
    // 1. Reconstruct the sighash for the input.
    // 2. Get the signature and public key from the unlocking script.
    // 3. Verify the public key matches controllerPublicKeyHex.
    // 4. Verify the signature against the sighash and public key.
    console.warn(`Signature verification for spending ${spentTxid}:${spentVout} is currently a placeholder. Implement robustly.`);
    const input = transaction.inputs[inputIndex];
    if (!input || !input.unlockingScript) return false;
    // This is a very naive check and NOT secure. Replace with actual crypto verification.
    return input.unlockingScript.toHex().length > 10; // Example: just check if script exists
  }

  async identifyAdmissibleOutputs(
    transaction: SdkTransaction,
    previousCoins: string[]
  ): Promise<AdmittanceInstructions<QuarkIdDidLookupServiceAdditionalDataOutputAdded, QuarkIdDidLookupServiceAdditionalDataOutputDeleted>> {
    const payload = this.currentDidPayload;

    if (!payload) {
      // console.log('QuarkIdDidTopicManager: No DID payload associated with transaction. Ignoring.');
      this.clearCurrentPayload();
      return { outputsToAdmit: [], coinsToRetain: previousCoins, additionalDataForLookupService: [], dataForDeletedOutputs: [] };
    }

    console.log(`QuarkIdDidTopicManager: Processing tx ${transaction.id('hex')} with payload:`, payload);

    const outputsToAdmit: { outputIndex: number; topic: string }[] = [];
    const additionalDataForLookupService: (QuarkIdDidLookupServiceAdditionalDataOutputAdded | undefined)[] = [];
    let dataForDeletion: QuarkIdDidLookupServiceAdditionalDataOutputDeleted | undefined = undefined;

    try {
      if (payload.operation === 'CREATE_DID') {
        const createPayload = payload as CreateDidPayload;
        if (!Utils.isHexString(createPayload.controller.publicKeyHex) || createPayload.controller.publicKeyHex.length !== 66) {
          throw new Error('CREATE_DID: Invalid controller public key format.');
        }
        const newControllerPubKey = PublicKey.fromString(createPayload.controller.publicKeyHex);
        const outputIndex = DEFAULT_STATE_UTXO_VOUT;
        const output: SDKOutput | undefined = transaction.outputs[outputIndex];

        if (!output || !output.lockingScript.isP2PKH() || !P2PKH.isValidTarget(output.lockingScript, newControllerPubKey)) {
          throw new Error(`CREATE_DID: Output ${outputIndex} is not a P2PKH to the specified controller or does not exist.`);
        }
        if (output.satoshis < MIN_STATE_UTXO_SATOSHIS) {
          throw new Error(`CREATE_DID: Output ${outputIndex} satoshis (${output.satoshis}) is below minimum (${MIN_STATE_UTXO_SATOSHIS}).`);
        }

        outputsToAdmit.push({ outputIndex, topic: DID_TOPIC_NAME });
        const newUtxoInfoForCreate: OutputInformation = {
          txid: transaction.id('hex'),
          vout: outputIndex,
          scriptHex: output.lockingScript.toHex(),
          satoshis: output.satoshis
        };
        additionalDataForLookupService[outputIndex] = { payload: createPayload, newUtxoInfo: newUtxoInfoForCreate };
        console.log(`QuarkIdDidTopicManager: CREATE validated for output ${outputIndex}.`);

      } else if (payload.operation === 'UPDATE_DID') {
        const updatePayload = payload as UpdateDidPayload;
        const { oldStateUtxo, newController } = updatePayload;
        if (!Utils.isHexString(newController.publicKeyHex) || newController.publicKeyHex.length !== 66) {
          throw new Error('UPDATE_DID: Invalid new controller public key format.');
        }
        const newControllerPubKey = PublicKey.fromString(newController.publicKeyHex);
        const inputIndex = transaction.inputs.findIndex(input => 
          input.sourceTXID === oldStateUtxo.txid && input.sourceOutputIndex === oldStateUtxo.vout
        );
        if (inputIndex === -1) throw new Error(`UPDATE_DID: Input spending UTXO ${oldStateUtxo.txid}:${oldStateUtxo.vout} not found.`);

        const controllerOfOldState = await this.storage.getControllerForUtxo(oldStateUtxo.txid, oldStateUtxo.vout);
        if (!controllerOfOldState) throw new Error(`UPDATE_DID: Could not find active controller for old state UTXO ${oldStateUtxo.txid}:${oldStateUtxo.vout}.`);
        
        if (!await this.verifyControllerSignature(transaction, inputIndex, oldStateUtxo.txid, oldStateUtxo.vout, controllerOfOldState.publicKeyHex)) {
          throw new Error(`UPDATE_DID: Signature verification failed for spending UTXO ${oldStateUtxo.txid}:${oldStateUtxo.vout}.`);
        }

        const outputIndex = DEFAULT_STATE_UTXO_VOUT;
        const output: SDKOutput | undefined = transaction.outputs[outputIndex];
        if (!output || !output.lockingScript.isP2PKH() || !P2PKH.isValidTarget(output.lockingScript, newControllerPubKey)) {
          throw new Error(`UPDATE_DID: Output ${outputIndex} is not a P2PKH to the new controller or does not exist.`);
        }
        if (output.satoshis < MIN_STATE_UTXO_SATOSHIS) {
          throw new Error(`UPDATE_DID: Output ${outputIndex} satoshis (${output.satoshis}) is below minimum (${MIN_STATE_UTXO_SATOSHIS}).`);
        }

        outputsToAdmit.push({ outputIndex, topic: DID_TOPIC_NAME });
        const spentUtxoInfoForUpdate: OutputInformation = {
          txid: oldStateUtxo.txid,
          vout: oldStateUtxo.vout,
          scriptHex: P2PKH.fromPubKey(PublicKey.fromString(controllerOfOldState.publicKeyHex)).getScriptPubkey().toHex(),
          satoshis: oldStateUtxo.satoshis || MIN_STATE_UTXO_SATOSHIS // Prefer actual, fallback to min
        };
        const newUtxoInfoForUpdate: OutputInformation = {
          txid: transaction.id('hex'),
          vout: outputIndex,
          scriptHex: output.lockingScript.toHex(),
          satoshis: output.satoshis
        };
        additionalDataForLookupService[outputIndex] = { 
          payload: updatePayload, 
          newUtxoInfo: newUtxoInfoForUpdate, 
          spentUtxoInfo: spentUtxoInfoForUpdate 
        };
        console.log(`QuarkIdDidTopicManager: UPDATE validated for output ${outputIndex}, spending ${oldStateUtxo.txid}:${oldStateUtxo.vout}.`);

      } else if (payload.operation === 'REVOKE_DID') {
        const revokePayload = payload as RevokeDidPayload;
        const { stateToRevoke } = revokePayload;
        const inputIndex = transaction.inputs.findIndex(input => 
          input.sourceTXID === stateToRevoke.txid && input.sourceOutputIndex === stateToRevoke.vout
        );
        if (inputIndex === -1) throw new Error(`REVOKE_DID: Input spending UTXO ${stateToRevoke.txid}:${stateToRevoke.vout} not found.`);

        const controllerOfState = await this.storage.getControllerForUtxo(stateToRevoke.txid, stateToRevoke.vout);
        if (!controllerOfState) throw new Error(`REVOKE_DID: Could not find active controller for state UTXO ${stateToRevoke.txid}:${stateToRevoke.vout}.`);

        if (!await this.verifyControllerSignature(transaction, inputIndex, stateToRevoke.txid, stateToRevoke.vout, controllerOfState.publicKeyHex)) {
          throw new Error(`REVOKE_DID: Signature verification failed for spending state UTXO ${stateToRevoke.txid}:${stateToRevoke.vout}.`);
        }
        
        const spentUtxoInfoForRevoke: OutputInformation = {
            txid: stateToRevoke.txid,
            vout: stateToRevoke.vout,
            scriptHex: P2PKH.fromPubKey(PublicKey.fromString(controllerOfState.publicKeyHex)).getScriptPubkey().toHex(),
            satoshis: stateToRevoke.satoshis || MIN_STATE_UTXO_SATOSHIS // Prefer actual, fallback to min
        };
        // For REVOKE, the additionalData is for outputDeleted in LookupService
        dataForDeletion = { payload: revokePayload, spentUtxoInfo: spentUtxoInfoForRevoke };
        console.log(`QuarkIdDidTopicManager: REVOKE validated for ${stateToRevoke.txid}:${stateToRevoke.vout}.`);
      } else {
        throw new Error(`Unsupported DID operation: ${(payload as any).operation}`);
      }

      if (outputsToAdmit.length === 0 && payload.operation !== 'REVOKE_DID') {
        console.warn(`QuarkIdDidTopicManager: No outputs admitted for tx ${transaction.id('hex')} with operation ${payload.operation}.`);
      }

    } catch (error: any) {
      console.error(`QuarkIdDidTopicManager: Error identifying admissible outputs for tx. Payload: ${JSON.stringify(payload)}. Error: ${error.message}`, error.stack);
      this.clearCurrentPayload();
      throw error; 
    } finally {
        this.clearCurrentPayload();
    }

    return {
      outputsToAdmit,
      coinsToRetain: previousCoins, 
      additionalDataForLookupService: additionalDataForLookupService.filter(Boolean) as QuarkIdDidLookupServiceAdditionalDataOutputAdded[],
      dataForDeletedOutputs: dataForDeletion ? [dataForDeletion] : []
    };
  }

  async getDocumentation(): Promise<string> {
    return docs;
  }

  async getMetaData(): Promise<any> {
    return {
      name: 'QuarkID DID Topic Manager',
      shortDescription: 'Manages DIDs for the "qdid" method using P2PKH state UTXOs and off-chain payloads.',
      topic: DID_TOPIC_NAME,
      version: '0.1.0'
    };
  }
}
