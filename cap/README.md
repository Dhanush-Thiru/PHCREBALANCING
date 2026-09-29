# PHC Pre-emptive Medicine Rebalancing Agent

Deployable SAP CAP Node.js project for SAP Business Application Studio and SAP BTP Cloud Foundry. The HANA HDI container owns persistent application data. CAP computes stock cover, safe donor surplus, route eligibility, and transfer quantities. SAP AI Core Generative AI Hub orchestration supplies explanation text only; a deterministic text fallback keeps proposals available if AI is unavailable. SAPUI5 is deployed to the HTML5 Applications Repository for SAP Build Work Zone.

All supplied facility, road, flood bulletin, and medicine stock data is simulated for the Kendrapara/Rajnagar hackathon scenario. Update the seed CSV files with approved demo values before deployment. This is a hackathon decision-support prototype, not a production clinical supply system.

## Project layout

- `db/schema.cds` and `db/data/*.csv`: HANA-persisted model and demo seed data.
- `srv/rebalancing-service.cds` and `.js`: OData V4 API, deterministic proposal rules, CMO decision guard, AI explanation call, and hash-chain audit.
- `app/phc/`: SAPUI5 dashboard, XSUAA-backed app route, and Work Zone intent metadata.
- `mta.yaml`, `xs-security.json`: Cloud Foundry MTA and role templates.

## 1. Open in Business Application Studio

1. In SAP Build Lobby, create/open the hackathon project and launch its Business Application Studio dev space.
2. In BAS, clone this repository or upload the workspace, then open the `cap` folder as the project root.
3. Confirm the Cloud Foundry CLI, Cloud MTA Build Tool (`mbt`), and MultiApps CF plugin are available in the dev space. Install SAP CAP tooling if needed: `npm install --global @sap/cds-dk mbt`.
4. Review the demo rows in `db/data/`. Keep the `facility_ID`, `medicine_ID`, and road endpoint IDs aligned with the keys in the CSV files.

## 2. Set up BTP services

1. In the BTP subaccount and Cloud Foundry space for the hackathon, confirm SAP HANA Cloud is running and reachable from Cloud Foundry.
2. Confirm the SAP AI Core service instance connected to AI Launchpad has a running Generative AI Hub orchestration deployment. Note the model name shown/configured for that orchestration setup and its resource group.
3. Check service quotas for HANA HDI, XSUAA, Destination, and HTML5 Application Repository. The MTA creates an HDI container, XSUAA instance, Destination instance, and HTML5 app-host instance. Reuse/add service resources if the hackathon administrator requires pre-created instances or restricts service creation.
4. If `phc-preemptive-rebalancing` is already used in the subaccount, change `xsappname` in `xs-security.json` to a unique value before first deploy. Keep the role names unchanged.

## 3. Build and deploy

In a BAS terminal with `cap` as the current directory:

```sh
npm install
npx cds build --production
mbt build -t gen --mtar phc.mtar
cf login --sso
cf target -o "<CF_ORG>" -s "<CF_SPACE>"
cf deploy gen/phc.mtar
```

Use the Cloud Foundry API endpoint and organization/space assigned to your hackathon. Do not put service keys or passwords in source files. If the MTA deploy reports that a required service plan is unavailable, ask the subaccount administrator which plan to use and update the corresponding `resources` entry in `mta.yaml`; do not replace HANA with a local database for the cloud deployment.

## 4. Connect Generative AI Hub

The CAP service uses SAP's `@sap-ai-sdk/orchestration` package and discovers AI Core credentials from a bound `aicore` service instance. Bind the AI Core instance connected to AI Launchpad to the deployed CAP service (use the exact instance name from your subaccount):

```sh
cf bind-service phc-srv "<AI_CORE_SERVICE_INSTANCE>"
cf set-env phc-srv AI_MODEL_NAME "<MODEL_NAME_FROM_AI_LAUNCHPAD>"
cf set-env phc-srv AI_RESOURCE_GROUP "<RESOURCE_GROUP>"
cf restage phc-srv
```

If your hackathon subaccount does not allow service binding, use the service key only through the SAP SDK's supported local configuration mechanism and store it as a protected BAS/Cloud Foundry secret. Never commit that key. Keep `AI_MODEL_NAME` aligned with a model available to the running orchestration deployment. The application falls back to fixed explanatory text if AI is unconfigured or unavailable; transfer quantities and statuses remain CAP-calculated.

## 5. Set role access

In the BTP cockpit, open the XSUAA instance created by the deployment, then assign the generated role collections to hackathon users:

- `PHC Medical Officer`: activate the simulated flood bulletin and generate proposals.
- `District CMO`: view proposals and approve/reject pending controlled medicine transfers.

The role checks are enforced by CAP/XSUAA on the service actions. The CMO decision action accepts only `PENDING_CMO` controlled-medicine proposals.

## 6. Add the app to SAP Build Work Zone

1. Open SAP Build Work Zone in the same BTP subaccount as the HTML5 app repository.
2. In Site Manager / Content Manager, refresh or update the HTML5 Apps content provider after deployment.
3. Add **PHC Medicine Rebalancing** to the site from the provider's available content. Its inbound intent is `PHCRebalancing-display`.
4. Grant the app to the relevant site/catalog roles and ensure those site roles map to the XSUAA role collections above.
5. Open the tile, activate the flood bulletin, generate proposals, and verify that controlled items show CMO actions only for users with the CMO role.

SAP Build Lobby is the project entry point and organizes the BAS development space and Work Zone project. It is not a runtime for the CAP service.

## API

CAP exposes OData V4 at `/odata/v4/rebalancing/`:

- Read entities: `Facilities`, `Medicines`, `Stocks`, `RoadSegments`, `FloodBulletins`, `Transfers`, and `AuditLogs`.
- Actions: `setFlood`, `proposeTransfers`, `decide`, and `verifyAudit`.

Use an authenticated OData client (or the deployed Work Zone app); modifying actions require a valid XSUAA session and CSRF token.

## Important limits

- Flood/road intersection is represented by the seeded road-segment `isOpen` and flood-bulletin state. The starter does not yet ingest live CWC/IMD/e-Aushadhi feeds or run a HANA spatial intersection/graph algorithm.
- Routing chooses the fastest seeded open donor road. Add validated road geometry and HANA spatial/graph artifacts before claiming GIS-derived routing.
- Stock transfers are proposed and governed in this starter; add a warehouse dispatch/receipt workflow before treating approval as physical stock movement.
- Hash chaining detects edits to the event sequence, but production-grade tamper evidence also needs restricted database privileges, retention/backup controls, and concurrency-safe sequencing for multiple service instances. Keep the service at one instance for the hackathon demo.
- Explanation text is generated by the configured orchestration model or replaced by deterministic fallback text. Do not send patient-identifiable data to the model.

## SAP references

- [CAP deployment to Cloud Foundry](https://cap.cloud.sap/docs/guides/deploy/to-cf)
- [CAP with SAP HANA Cloud](https://cap.cloud.sap/docs/guides/databases/hana)
- [SAP Cloud SDK for AI JavaScript](https://github.com/SAP/ai-sdk-js)
- [Generative AI Hub orchestration](https://help.sap.com/docs/ai-launchpad/sap-ai-launchpad-user-guide/orchestration-4953dc10c6dd48fe85f37b41109dffe2)
- [Expose HTML5 applications in SAP Build Work Zone](https://help.sap.com/docs/build-work-zone-advanced-edition/sap-build-work-zone-advanced-edition/expose-html5-applications-in-sap-build-work-zone-advanced-edition)
