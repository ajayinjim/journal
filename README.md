# Journal Publication System

Journal Desk manages submissions, peer review and issue production. React and HTML provide the browser interface. A Netlify Function passes authenticated requests to Google Apps Script. Google Sheets holds journal records and Google Drive stores private PDFs. Users visit the Netlify URL and sign in with a code sent to their email address.

## Try the local demo

Use Node.js 22.12 or later. From this directory run:

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. Select Managing editor, Author or Reviewer in the demo panel, request a code, and enter **246810**. The demo runs against a temporary in-memory implementation of the Google services. It sends no email. Restarting Vite resets the sample records. Netlify's production build uses the live function and omits the demo controls and demo server.

## Deploy the Google backend

1. In a Google Workspace account that will own the journal data, create a standalone project at [script.google.com](https://script.google.com/).
2. Replace the default code with [apps-script/Code.gs](apps-script/Code.gs). Under **Project Settings**, enable the option to show the manifest file and replace it with [apps-script/appsscript.json](apps-script/appsscript.json).
3. Add these two **Script properties** under **Project Settings**.

   | Property | Value |
   | --- | --- |
   | `INITIAL_ADMIN_EMAIL` | Email address of the first managing editor |
   | `JOURNAL_API_SECRET` | A random secret of at least 32 characters. Generate one with `openssl rand -hex 32` or a password manager. |

4. Run **setupJournal** from the editor and approve the Google permissions for the account that owns the project. This creates the Sheets tables and Drive folder, initializes the journal, and registers the first admin. The execution log lists the spreadsheet and folder IDs. Rerunning setup with the same configuration preserves records.
5. Choose **Deploy → New deployment → Web app**. Set **Execute as** to **Me**, and **Who has access** to **Anyone** so the Netlify server can call it. The application verifies the server-side secret before processing each request. Keep the Sheet and Drive folder private. Some Workspace domains restrict the Anyone option. The Workspace administrator must permit it for this deployment model to work.
6. Copy the deployment URL ending in `/exec`. For later backend updates, edit the same deployment and deploy a new version so the URL stays valid.
7. In **Triggers**, optionally add a daily time-driven trigger for **cleanExpiredJournalData**. It clears expired codes and sessions and trashes unattached uploads older than one day. PDFs attached to a manuscript version or current final article are retained.

[Google Apps Script web-app deployment](https://developers.google.com/apps-script/guides/web) · [Apps Script service quotas](https://developers.google.com/apps-script/guides/services/quotas)

## Deploy the React app to Netlify

1. Extract this archive and push its contents to a Git repository you control. The repository root should contain `netlify.toml` and `package.json`.
2. Import that repository in Netlify. The included configuration uses `npm run build`, publishes `dist` and deploys the `netlify/functions` directory. Use the repository connection or a full Netlify CLI deploy so the function is included.
3. In the site’s environment variables, add the following values and make them available to **Functions**. Use the same secret as in Apps Script. Keep these values server-side and out of Git.

   | Variable | Value |
   | --- | --- |
   | `JOURNAL_SCRIPT_URL` | The Apps Script `/exec` address |
   | `JOURNAL_API_SECRET` | The matching Apps Script secret |

4. Deploy, then open the Netlify HTTPS URL. Sign in with the initial admin email and the verification code received in your inbox. In **Master setup**, enter your journal’s name, publisher, ISSN, editorial contact and manuscript sections.
5. Test the live setup using separate admin, author and reviewer emails. Register a test author, add a reviewer from the admin account, submit three small PDFs, assign the reviewer, submit a recommendation, accept the paper, and export and publish a test issue. Use a separate Apps Script project and storage for this check to keep test records out of the production journal.

[Netlify Functions configuration](https://docs.netlify.com/build/functions/configuration/)

## Run the journal

| Role | Workflow |
| --- | --- |
| Managing editor | Configure the journal and manage reviewers. Search and filter all submissions, assign or replace a reviewer, record decisions and notes for authors, upload final article PDFs, schedule accepted articles, export issues and mark them Published. |
| Author | Register and verify email. Submit metadata, a title page, an anonymised manuscript and signed undertaking. See the status and decision history. Upload a new version when revisions are requested. Download the final article after publication. |
| Reviewer | Sign in using the email registered by the editor. See currently assigned manuscripts, download the assigned review copy and submit a recommendation with comments and optional confidential notes. Submission marks the reviewer’s assignment complete. The editor records the author-facing decision. |

The editor can assign one reviewer at a time. Reassignment revokes the previous reviewer’s file access and keeps completed reports for the editor. Anonymisation depends on the author removing identifying details from the manuscript, abstract and PDF metadata before submission. Reviewer access excludes the title page and undertaking, and downloaded review copies use the manuscript reference as their filename.

One-time codes expire after ten minutes, allow five verification attempts, and are limited per email and network. Sessions last 12 hours. The Netlify site is the user-facing entry point. The initial admin is set during Apps Script setup. To add a second managing editor, change `INITIAL_ADMIN_EMAIL` to the new email and rerun setup. This does not deactivate the original admin. Keep the Apps Script editor and data store limited to trusted maintainers.

Each upload accepts a PDF of up to **4 MiB**. Compress larger files before uploading. Google Apps Script and MailApp quotas apply. Back up the Sheets records and private Drive files together.

## Print an issue

1. Create a draft issue with a volume, issue number, year and title.
2. In each accepted paper’s **Production** panel, upload its final, typeset **portrait A4 PDF**. Use matching crop and trim sizes and remove password protection. Prepare the source PDFs with the fonts, images and margins required by the printer.
3. Schedule each article in the draft and assign its print position. The app assembles articles in ascending position order.
4. Open **Issues → Export print PDF**. The result includes a cover, a table of contents with article start page numbers, and the final article pages. Production assembly takes place in the editor's browser and preserves the article pages without reflow. Cover and contents fonts support Latin and Devanagari text.
5. Proof the downloaded PDF before sending it to the printer. Output is an A4 PDF. Printer-specific PDF/X, bleed, colour profile and press preflight requirements depend on your print provider.
6. Select **Publish issue** after exporting. Articles show as Published in their authors' dashboards, and the issue and article placements become locked. Editors can export the published issue again. Publication status is internal to the portal. A public journal archive, DOI registration and sending files to the print vendor are outside this implementation.

## Local verification

`npm test` exercises registration, session controls, manuscript access by role, review and revision, decisions, issue export, publication locking and the Netlify endpoint. `npm run build` creates the production frontend. Automated checks simulate Google and Netlify services. Verify real OTP delivery and backend connectivity in your accounts using the deployment smoke test above.
