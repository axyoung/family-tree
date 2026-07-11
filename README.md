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

### Installation

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/your-username/young-shan-family-tree.git](https://github.com/your-username/young-shan-family-tree.git)
   cd young-shan-family-tree
   ```
2. **Install Dependencies**
   ```bash
   npm install
   ```
3. **Run the Development Server**
   ```bash
   npm run dev
   ```

## 🛡️ Privacy & Governance

Because this registry contains living individuals and private family data, all contributors must respect the following security practices:
* Never share login credentials outside verified members of the **Young/Shan** family.
* Ensure written or verbal consent is acquired before uploading sensitive documents or private contact information.
* Report any unexpected data discrepancies or public exposure to the repository administrator immediately.