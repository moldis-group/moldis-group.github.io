# Research Exchange — GitHub Pages Q&A forum

A small-group Q&A forum with email/password accounts, questions, answers, upvotes, accepted answers, topic filtering, and a live all-time leaderboard.

## Files
- `index.html`: user interface
- `style.css`: responsive design
- `app.js`: forum logic using the Firebase browser SDK
- `firebase-config.js`: your Firebase web-app configuration
- `firestore.rules`: mandatory Firestore access-control rules

## Set up Firebase (required for a shared forum)
1. Open https://console.firebase.google.com/ and create a Firebase project.
2. Add a **Web app** in project settings. Copy the Firebase config values into `firebase-config.js` (replace placeholders).
3. Go to **Build → Authentication → Sign-in method** and enable **Email/Password**.
4. Go to **Build → Firestore Database**, create a database, and choose an appropriate region. **Never leave test-mode rules in place.**
5. Open **Firestore Database → Rules**, replace the rules with the contents of `firestore.rules`, and **Publish** them.
6. Under **Authentication → Settings → Authorized domains**, add your GitHub Pages domain, such as `USERNAME.github.io`, if it isn't already present. Email/password auth typically works without a redirect, but this is still good to verify for future login methods.
7. To keep the group private, register only invited members or disable public sign-up in `index.html` / `app.js` and create member accounts through Firebase Authentication. **Important:** The provided registration form permits anyone who knows the URL to create an account; the Firestore rules enforce sign-in but do **not** restrict membership. For a truly private research group, restrict sign-up using a server-side invitation / approved-user allowlist enforced in Firestore rules, not just a hidden button. See note below.

## Publish to GitHub Pages
1. Create a GitHub repository, e.g. `research-exchange`.
2. Upload `index.html`, `style.css`, `app.js`, `firebase-config.js`, and optionally `README.md` (do **not** need to expose `firestore.rules`, but keep it in your repository for reference).
3. In **Settings → Pages**, choose **Deploy from a branch**, select `main`, and select `/ (root)`.
4. Your forum will be available at `https://USERNAME.github.io/research-exchange/`.
5. Visit the URL, register an account, and create the first question.

## Points
- Post a question: **+2**
- Post an answer: **+5**
- Get an answer accepted: **+15**
- Receive an upvote: **+2**

Scores are derived from the database, not editable score fields. One vote per account per item; no self-voting. The forum uses Firestore real-time listeners.

## Security and scalability notes
- GitHub Pages only hosts static HTML/CSS/JS; **Firebase provides the shared database and authentication**.
- The Firebase web config is not a secret. **Firestore rules are essential**.
- **The sample is a starter, not production-hardened access control.** A Firebase Auth account can be created by anybody while open registration is enabled. Disabling the sign-up button alone does not secure Firestore; use a Firebase custom claims / server-managed approved-member allowlist for a genuinely private forum.
- For a private forum, another practical approach is to enforce an email domain or maintain an allowlist in Firestore rules with administrator-managed membership documents. Email-domain checks should require verified email addresses.
- Large forums should use paginated queries, stored aggregates or server-side rankings, anti-spam controls, and moderation. This small-group starter currently loads full collections into clients and calculates scores locally.
- Firebase Spark plan has usage quotas. Monitor quotas in the Firebase console.
- Plain text and triple-backtick code blocks are supported. LaTeX input is stored as text but **not typeset** in this starter. Add KaTeX/MathJax later if desired.
- Display names are recorded in posts. Changing an account profile later will not rewrite past posts.

## Local testing
ES module imports don't work reliably from `file://`. Run a local web server:
```sh
python3 -m http.server 8000
```
Then open http://localhost:8000/.
