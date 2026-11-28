import { useState } from "react";
import { Card } from "../../components/ui/Card";
import { GLOSSARY } from "./terms";
import "../feature-pages.css";
export function GlossaryPage() {
  const [query,setQuery] = useState("");
  const terms = GLOSSARY.filter(t=>`${t.term} ${t.de} ${t.short}`.toLowerCase().includes(query.toLowerCase()));
  return <Card><label>Begriff suchen <input type="search" value={query} onChange={e=>setQuery(e.target.value)} /></label><div className="table-scroll"><table><thead><tr><th>Begriff</th><th>Definition</th></tr></thead><tbody>{terms.map(t=><tr key={t.id}><th scope="row">{t.de} <small>({t.term})</small></th><td>{t.short}</td></tr>)}</tbody></table></div>{!terms.length && <p>Keine Treffer.</p>}</Card>;
}
