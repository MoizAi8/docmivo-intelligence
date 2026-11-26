import Link from "next/link";
import Image from "next/image";
import { ArrowDown, ArrowUpRight, FileText, Fingerprint, Search, ShieldCheck, Sparkles } from "lucide-react";

export function Logo() {
  return <Link href="/" className="brand" aria-label="Docmivo home"><Image src="/brand/mark.svg" width={34} height={34} alt="" priority /><span>docmivo<span>.</span></span></Link>;
}

export function MarketingHeader() {
  return <header className="m-header"><div className="m-shell m-navbar">
    <Logo /><nav aria-label="Main navigation"><Link href="/product">Product</Link><Link href="/security">Security</Link></nav>
    <div className="m-account"><Link href="/sign-in">Sign in</Link><Link href="/workspace" className="btn primary">Open workspace <ArrowUpRight size={15} /></Link></div>
  </div></header>;
}

export function MarketingFooter() {
  return <footer className="m-footer"><div className="m-shell m-end">
    <div><Logo /><p>Find what matters.</p></div>
    <nav aria-label="Footer"><Link href="/product">Product</Link><Link href="/security">Security</Link><Link href="/sign-in">Sign in</Link></nav>
    <small>© {new Date().getUTCFullYear()} Docmivo</small>
  </div></footer>;
}

export function DocumentIllustration() {
  return <figure className="hero-art" aria-label="Illustration of a search result linking to a highlighted passage in a fictional field guide">
    <div className="art-grid" aria-hidden="true" />
    <div className="art-note" aria-hidden="true"><span /><span>THE SOURCE VIEW</span></div>
    <div className="paper paper-back" aria-hidden="true" /><div className="paper paper-middle" aria-hidden="true" />
    <div className="paper paper-front" aria-hidden="true">
      <div className="paper-top"><FileText size={15} /><span>ALDER OBSERVATORY</span><span>FIELD GUIDE</span></div>
      <div className="paper-title">The reading<br />room.</div>
      <div className="paper-rule" />
      <div className="paper-lines"><span /><span /><span /></div>
      <p className="art-highlight">The reading room is open on<br /><strong>Thursdays from 10:00 to 16:00.</strong></p>
      <div className="paper-lines bottom"><span /><span /></div>
      <div className="paper-foot"><span>VISITOR INFORMATION</span><span>02</span></div>
    </div>
    <div className="art-search" aria-hidden="true"><Search size={17} /><span>reading room hours</span><kbd>⌘ K</kbd></div>
    <div className="source-connector" aria-hidden="true" />
    <div className="art-source" aria-hidden="true"><div className="source-icon"><Fingerprint size={21} /></div><div><strong>Reading room</strong><span>Alder Observatory · Field Guide</span></div><span className="source-counter">01</span></div>
    <figcaption>Illustration · Fictional field guide</figcaption>
  </figure>;
}

export function HomeStory() {
  return <>
    <section className="m-shell m-story" id="workflow">
      <div className="section-heading"><span className="section-label">THE WORKFLOW</span><h2>Follow the thread<br />back to its source.</h2></div>
      <div className="story-rows">
        <article><div className="story-icon"><FileText /></div><div><h3>Build your library</h3><p>Bring PDFs, Word documents, text, and Markdown into one private workspace. Organize files with folders, tags, and favorites.</p></div></article>
        <article><div className="story-icon"><Search /></div><div><h3>Search across your documents</h3><p>Search titles, tags, notes, and indexed text. Use filters to narrow results, then jump straight to the matching page or section.</p></div></article>
        <article><div className="story-icon"><Fingerprint /></div><div><h3>Keep the passage</h3><p>Bookmark a source or write a note while you read. Every saved passage leads back to the original document.</p></div></article>
      </div>
    </section>
    <section className="privacy-band"><div className="m-shell privacy-inner">
      <div className="privacy-icon"><ShieldCheck size={36} strokeWidth={1.4} /></div>
      <div><span className="section-label">PRIVATE BY DEFAULT</span><h2>Your files stay in your workspace.</h2><p>Keyword search works through Docmivo’s database. External AI is restricted to built-in fictional guides and eligible invited testers.</p><Link href="/security">Read the security approach <ArrowUpRight size={16} /></Link></div>
    </div></section>
    <section className="m-shell m-faq" aria-labelledby="faq">
      <div><span className="section-label">BEFORE YOU START</span><h2 id="faq">Good to know.</h2></div>
      <div>
        <details><summary>What files can I bring?</summary><p>Upload text-based PDFs, DOCX, plain text, or Markdown up to 2 MiB each. Scanned PDFs need OCR before they can be searched.</p></details>
        <details><summary>Can I search without enabling AI?</summary><p>Yes. Keyword search, source navigation, and bookmarks all work without an AI provider.</p></details>
        <details><summary>How do I get access?</summary><p>Use an invite to create your account. You can import the built-in fictional guides to explore the library and source reader.</p></details>
      </div>
    </section>
  </>;
}

export function Hero() {
  return <section className="m-shell hero">
    <div className="hero-copy">
      <span className="hero-label"><span /> PRIVATE DOCUMENT INTELLIGENCE</span>
      <h1>Find what<br /><em>matters.</em></h1>
      <p>Turn a pile of documents into a library you can search, read, and cite with confidence.</p>
      <div className="hero-actions"><Link className="btn primary" href="/workspace">Launch workspace <ArrowUpRight size={19} /></Link><a href="#workflow" className="hero-secondary">See how it works <ArrowDown size={16} /></a></div>
      <div className="hero-formats"><span>SUPPORTED FORMATS</span> PDF <i /> DOCX <i /> Markdown <i /> TXT</div>
    </div>
    <DocumentIllustration />
  </section>;
}

const info = {
  product:{
    label:"THE PRODUCT",heading:"A library that leads to the source.",description:"Organize, search, and read your documents in one private workspace.",icon:Search,
    sections:[
      ["The library","Upload a supported file and follow its indexing status. Group documents into folders, add tags, and favorite files you revisit."],
      ["Keyword search","Open search from anywhere in the workspace with Ctrl or ⌘ and K. Filter by format, folder, tag, date, or favorite. Matching passages open directly in the extracted-text reader."],
      ["Source reading","Keep the original download available alongside indexed text. Bookmark a passage and save notes for later."],
      ["Fictional guide analysis","Eligible invited testers can ask preset questions, summarize, compare, and extract information from the built-in guides using Gemini. Answers carry verified quotations from the retrieved passages."]
    ]
  },
  security:{
    label:"SECURITY & PRIVACY",heading:"Your documents, under your control.",description:"Docmivo defaults to a private library. Indexed keyword search runs without external AI.",icon:ShieldCheck,
    sections:[
      ["Invite-only accounts","Each account has its own workspace. Private requests check the signed-in account and workspace, and PostgreSQL applies row-level policies to workspace data."],
      ["Private files","Original uploads are stored in PostgreSQL. Download links require a signed-in owner. The reader renders extracted text, and the upload pipeline limits file size and parsing time."],
      ["External AI eligibility","Only built-in fictional guide excerpts and preset public questions are eligible for unpaid Gemini. Private files, private notes, and arbitrary queries are excluded. Eligible testers must confirm each external request."],
      ["Deletion","Deleting a document removes its stored file and indexed sources. Account deletion removes the workspace. Provider backups may retain older states according to their retention policy."]
    ]
  }
} as const;

export function InformationPage({ page }:{page:keyof typeof info}) {
  const current=info[page], Icon=current.icon;
  return <><MarketingHeader /><main id="main" className="m-shell information">
    <div className="information-hero"><span className="section-label">{current.label}</span><h1>{current.heading}</h1><p>{current.description}</p><Icon size={135} strokeWidth={.65} aria-hidden="true" /></div>
    <div className="information-body">{current.sections.map(([heading,text])=><article key={heading}><h2>{heading}</h2><p>{text}</p></article>)}</div>
    <Link href="/workspace" className="btn primary">Open workspace <ArrowUpRight size={16} /></Link>
  </main><MarketingFooter /></>;
}

export function AuthAside() {
  return <aside className="auth-aside"><div className="auth-monogram"><Sparkles strokeWidth={1.2} size={39} /></div><div><span className="section-label">YOUR PRIVATE LIBRARY</span><p>Return to the<br /><em>source.</em></p></div></aside>;
}
