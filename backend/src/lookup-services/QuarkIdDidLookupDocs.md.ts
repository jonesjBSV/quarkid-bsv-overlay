export default `# QuarkID DID Lookup Service

This service resolves Decentralized Identifiers (DIDs) managed by the QuarkIdDidTopicManager.
It supports the 'did:bsv-overlay:qdid' method.

## Query Format

Queries should be the full DID string, e.g., 'did:bsv-overlay:qdid:<initial-txid>:<initial-vout>'.

## Response Format

The service returns a standard DID Resolution result structure, including the DIDDocument and metadata.
`
