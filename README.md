## quarkid-bsv-overlay
If you have problems accessing hosts:

Try using your browser with a command switch. Ensure you use a temporary profile if you do disable your security settings.

For Linux:
`brave-browser --disable-web-security --user-data-dir="/tmp/brave_dev"`

# BSV Project

Standard BSV project structure.

Helpful Links:

- [LARS (for local development)](https://github.com/bitcoin-sv/lars)

## Getting Started

- Clone this repository
- Run `npm i` to install dependencies
- Run `npm run lars` to configure the local environment according to your needs
- Use `npm run start` to spin up and start writing code

## Directory Structure

The project structure is roughly as follows, although it can vary by project.

```
| - deployment-info.json
| - package.json
| - local-data/
| - backend/
  | - package.json
  | - tsconfig.json
  | - mod.ts
  | - src/
    | - contracts/...
    | - lookup-services/...
    | - topic-managers/...
    | - script-templates/...

## License

[Open BSV License](./LICENSE.txt)
