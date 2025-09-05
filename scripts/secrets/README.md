# Generate
```bash
node gen-keys.js ./keys-raw.json
KEY_PASSWORD='yourkeystorepassword' node build-secrets.js ./keys-raw.json
```

# Import
```bash
# EVM:
curl -X POST "http://NODE/v2/keys/evm/import?oldpassword=secret&evmChainID=11155111" \
  -H "Authorization: Bearer <TOKEN>" --data-binary @evm_keystore.json

# P2P:
curl -X POST "http://NODE/v2/keys/p2p/import?oldpassword=secret" \
  -H "Authorization: Bearer <TOKEN>" --data-binary @p2p_key.json

# OCR:
curl -X POST "http://NODE/v2/keys/ocr/import?oldpassword=secret" \
  -H "Authorization: Bearer <TOKEN>" --data-binary @ocr_key.json
```
