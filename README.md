# 🌳 Young/Shan Family Registry & Tree

An interactive and secure digital archive and lineage tracker built specifically for the **Young/Shan** family. This application serves as a living registry to preserve our shared history, document generations, and provide an interactive visual experience of our family tree.

Built with performance, privacy, and seamless interactivity in mind, the platform allows authorized family members to explore their heritage and securely contribute updates to the lineage.

The Family Tree website itself is currently hosted on the site: https://family-tree-two-mauve.vercel.app/.

---

## TO IMPLEMENT:
* suggestions from users

---

## ✨ Features

* **Interactive Lineage Visualization:** Powered by `family-chart`, offering smooth panning, zooming, and dynamic expansion/collapsing of family branches.
* **Secure Family Authentication:** Protected by Supabase Auth, ensuring that sensitive family data, contact information, and personal records remain accessible *only* to verified family members.
* **Dynamic Registry Updates:** Real-time database synchronizations allowing authorized members to add new milestones (births, marriages, passings) and automatically re-render the tree.
* **Media & Profile Archives:** Rich profile cards supporting high-quality photos, historical bios, and historical document attachments stored securely.
* **Custom Blended Family Layers:** Tailored structural workarounds utilizing the partnership layer to perfectly map complex, multi-parent, and blended lineages elegantly within the visual UI.

---

## 🛠️ Tech Stack

* **Frontend Tooling:** [Vite](https://vitejs.dev/) – Ultra-fast build tool and development server.
* **Tree UI Engine:** [family-chart](https://github.com/donatso/family-chart) – D3-based customizable rendering engine for complex family structures.
* **Backend & Database:** [Supabase](https://supabase.com/) – PostgreSQL database with Realtime capabilities.
* **Authentication & Security:** [Supabase Auth](https://supabase.com/docs/guides/auth) – Secure row-level security (RLS) policies to keep family data private.
* **Hosting & Deployment:** [Vercel](https://vercel.com/) – Global edge network deployment with continuous integration directly from Git.

---

## 🚀 Getting Started

### Prerequisites

Ensure you have the following installed on your local environment:
* [Node.js](https://nodejs.org/) (v18.0.0 or higher)
* [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)
* A [Supabase](https://supabase.com/) account and project setup.
* A [Vercel](https://vercel.com/) account and project setup

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/axyoung/family-tree.git
   cd family-tree
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up Supabase (backend: database, storage, auth):**

   - Go to [supabase.com](https://supabase.com) and create a free account + new project. Wait a minute or two for it to finish provisioning.
   - **Run the schema**: Dashboard → **SQL Editor** → New query → paste the entire contents of `supabase/schema.sql` → Run.
     - If you're updating an existing project instead of starting fresh, run the relevant `supabase/migration-*.sql` files in order instead (see comments at the top of each).
   - **Create the photos bucket**: Dashboard → **Storage** → New bucket → name it exactly `family-photos` → toggle **Public bucket** ON.
   - **Create your admin login**: Dashboard → **Authentication** → Users → Add user → your own email + password. This is used to review delete requests and manage the tree directly.
   - **Set your passwords**: Dashboard → **SQL Editor** → run:
     ```sql
     select set_view_password('choose-a-viewing-password');
     select set_edit_password('choose-an-editing-password');
     ```
   - **Get your API credentials**: Dashboard → **Project Settings** → **Data API** → copy the **Project URL** and the **Publishable key** (this replaces the older "anon key" naming — use it the same way).

4. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   Open `.env` and fill in your Supabase Project URL and Publishable key from the previous step.

5. **Seed initial data (optional):**
   If you want to start from the sample family in `src/data.js`:
   ```bash
   node scripts/seed.mjs your-admin-email your-admin-password
   ```

6. **Run the development server for testing:**
   ```bash
   npm run dev
   ```
   Visit `http://localhost:5173` for the tree, and `http://localhost:5173/admin.html` to review pending delete requests.

### Deploying to Vercel

1. Push this repository to GitHub (or GitLab/Bitbucket).
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → import the repository.
3. Vercel auto-detects this as a Vite project. Confirm these settings (usually pre-filled correctly):
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Install Command**: `npm install`
4. Before deploying, add your environment variables: Project Settings → **Environment Variables**:
   ```
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-publishable-key
   ```
   (These must be set here, not just in your local `.env`, since Vite bakes them in at build time and `.env` is gitignored.)
5. Deploy. Once live, check both `your-site.vercel.app/` and `your-site.vercel.app/admin.html` load correctly — this project has two entry points.

**Updating after the initial deploy:**
- If your Vercel project is linked to your GitHub repo (the default), just `git commit` + `git push` — Vercel automatically rebuilds and redeploys. You never need to run `npm run build` yourself; Vercel runs it on their end.
- If you're deploying via the Vercel CLI instead, run `vercel --prod` from the project folder after making changes.

## 🛡️ Privacy & Governance

Because this registry contains living individuals and private family data, all contributors must respect the following security practices:
* Never share login credentials outside verified members of the **Young/Shan** family.
* Ensure written or verbal consent is acquired before uploading sensitive documents or private contact information.
* Report any unexpected data discrepancies or public exposure to the repository administrator immediately.

