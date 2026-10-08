"""Semantische Kontextdatenbank für Regelwerke, Guidelines und interne Vorgaben.

Kernidee: Texte werden nicht nach exakten Wörtern durchsucht, sondern nach ihrer
*Bedeutung*. Jeder Abschnitt (Chunk) wird lokal in einen Vektor (Embedding)
übersetzt — per TF-IDF + SVD (Latent Semantic Analysis). Dadurch findet die
Suche nach "Verschlüsselung" auch Abschnitte über "Kryptografie", "Chiffrierung"
oder "Zertifikate", obwohl diese Wörter nicht wörtlich vorkommen. Umgekehrt
findet die Suche nach "Wir setzen TLS 1.2 ein" den BSI-Baustein "CON.1
Kryptokonzept", weil beide im selben thematischen Raum liegen.

Alles läuft lokal: keine Cloud-API, kein Modell-Download. Die Embeddings werden
aus dem eigenen Dokumentenkorpus gelernt (unsupervised). Als Vektordatenbank
dient ein persistenter NumPy-Speicher unter ``context_db/`` — funktional
vergleichbar mit Qdrant/Chroma, aber ohne externe Modell-Downloads.

BSI-Struktur: Beim Chunking werden Baustein-IDs (``CON.1``), Anforderungs-IDs
(``CON.1.A1``) und Prioritäten (MUSS/SOLLTE/KANN) erkannt und als Metadaten
pro Chunk gespeichert. Die Suche lässt sich darauf einschränken, z.B.
``db.search("Verschlüsselung", filter={"layer": "CON"})``.

Pipeline:
    PDF/DOCX -> Text -> Chunks (Absätze/Anforderungen mit Overlap + Metadaten)
             -> Embedding (TF-IDF + SVD, lokal trainiert)
             -> Vektor-Speicher (context_db/)
             -> semantische Suche (Cosine Similarity + Query-Expansion)
"""

from __future__ import annotations

import json
import pickle
import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

# Dimension der semantischen Vektoren (latente Themen)
EMBEDDING_DIMS = 300

# BSI-Grundschutz: Themenfelder (Layer) mit deutschen Namen
BSI_LAYERS = {
    "ISMS": "Sicherheitsmanagement",
    "ORP": "Organisation und Personal",
    "CON": "Konzeption und Vorgehen",
    "OPS": "Betrieb",
    "DER": "Detektion und Reaktion",
    "APP": "Anwendungen",
    "SYS": "IT-Systeme",
    "IND": "Industrielle IT",
    "NET": "Netze und Kommunikation",
    "INF": "Infrastruktur",
}

# BSI-Strukturmuster
_REQ_ID = re.compile(r"\b([A-Z]{2,4}\.\d+)\.A(\d+)\b")  # CON.1.A1
_BAUSTEIN_ID = re.compile(r"\b([A-Z]{2,4}\.\d+)\b")  # CON.1
_REQ_PRIORITY = re.compile(r"\.A\d+\s*[:.\-]?\s*(MUSS|SOLLTE|KANN)\b")
_ANY_PRIORITY = re.compile(r"\b(MUSS|SOLLTE|KANN)\b")
_HEADING_KEYWORDS = frozenset(
    {
        "einleitung",
        "gefährdungen",
        "anforderungen",
        "basis-anforderungen",
        "standard-anforderungen",
        "anforderungen für erhöhten schutzbedarf",
        "umsetzungshinweise",
        "rollen",
        "weitere informationen",
        "anhang",
    }
)


def _is_heading(para: str) -> bool:
    """Heuristik für Überschriften (nummeriert oder bekannte BSI-Abschnitte)."""
    if len(para) > 90 or "\n" in para:
        return False
    if re.match(r"^\d+(\.\d+)*\s+\S", para):
        return True
    first = re.split(r"[:\n]", para.strip().lower(), maxsplit=1)[0].strip()
    return first in _HEADING_KEYWORDS


# Deutsche Stopwords — lokal definiert, damit kein externes Paket nötig ist.
STOPWORDS_DE = frozenset(
    """
    aber als am an auch auf aus bei bin bis da damit das dem den der des
    dessen deren dich die dies diese diesem diesen dieser dieses dir doch dort
    du durch ein eine einem einen einer eines für gegen habt habe haben hat
    hatte ihnen ihr ihre ihrem ihren im immer in indem ist jede jedem jeden
    jeder jedes jene jenem jenen jener jenes jetzt kaum keine keinem keinen
    keiner meines mit mir nach nachdem nein nicht nun nur ob ohne sein seine
    seinem seinen sich sie sind so solche solchem solchen solcher solches soll
    sollte sondern über um und uns unter vom von vor wann war wäre waren warum
    was wegen weil weiter welche welchem welchen welcher welches wenn wer
    werde werden wie wieder will wir wird wirklich wollen wurde wurden zu zum
    zur zuerst zusammen zwischen
    """.split()
)

# Stemming für Deutsch — verbindet Flexionsformen ("Passwort"/"Passwörter",
# "Zertifikat"/"Zertifikate", "nächtlich"/"nächtliches"). nltk ist ein reines
# Python-Paket; der Snowball-Stemmer arbeitet algorithmisch und braucht
# keinen Modell-Download (Firewall-sicher).
try:
    from nltk.stem.snowball import SnowballStemmer

    _STEMMER: SnowballStemmer | None = SnowballStemmer("german")
except ImportError:  # Fallback: ohne Stemming (nltk nicht installiert)
    _STEMMER = None


def _stem_word(word: str) -> str:
    """Stemmt ein Wort auf Deutsch (oder lowercased als Fallback)."""
    if _STEMMER is not None:
        return _STEMMER.stem(word.lower())
    return word.lower()


# Stopwords in der Stemming-Stufe — sonst greifen sie nicht, weil die Tokens
# gestemmt sind. Werden direkt im Tokenizer gefiltert (vermeidet die
# sklearn-Konsistenzwarnung bei custom tokenizer + stop_words).
_STEMMED_STOP: frozenset = frozenset(_stem_word(w) for w in STOPWORDS_DE)


def _tokenize(text: str) -> list[str]:
    """Tokenisiert (>= 2 Zeichen), stemmt auf Deutsch, filtert Stopwords."""
    tokens = re.findall(r"(?u)\b\w\w+\b", text.lower())
    if _STEMMER is not None:
        tokens = [_STEMMER.stem(t) for t in tokens]
    return [t for t in tokens if t not in _STEMMED_STOP]


# Kuratierte IT-Security-Synonyme (Deutsch) — Query-Boost mit hoher Präzision.
# Werden bei der Expansion mitgegeben, wenn der Begriff (in beliebiger
# Flexionsform) in der Query vorkommt. Sie schließen Lücken, die der Stemmer
# allein nicht findet: "Verschlüsselung" (verschlussel) vs "verschlüsselt"
# (verschlusselt), "Kryptografie" (kryptografi) vs "kryptografische"
# (kryptograf), "Chiffren" (chiffr) vs "Chiffrierung" (chiffrier),
# "Backup" (backup) vs "Backups" (backups). Keys und Werte werden beim Laden
# gestemmt, damit alle Flexionsformen matchen.
DOMAIN_SYNONYMS: dict[str, list[str]] = {
    "TLS": [
        "Verschlüsselung",
        "Kryptografie",
        "kryptografische",
        "Zertifikat",
        "HTTPS",
        "Übertragung",
        "Transportverschlüsselung",
    ],
    "HTTPS": ["TLS", "Verschlüsselung", "Zertifikat", "Webseite"],
    "Transportverschlüsselung": ["TLS", "Verschlüsselung", "Übertragung", "HTTPS"],
    "Verschlüsselung": [
        "Kryptografie",
        "kryptografische",
        "Chiffrierung",
        "Chiffren",
        "Zertifikat",
        "Schlüssel",
        "TLS",
    ],
    "verschlüsselt": [
        "Kryptografie",
        "kryptografische",
        "Chiffrierung",
        "Zertifikat",
        "Schlüssel",
        "TLS",
    ],
    "Kryptografie": [
        "Verschlüsselung",
        "Chiffrierung",
        "Chiffren",
        "Zertifikat",
        "kryptografische",
    ],
    "kryptografisch": [
        "Verschlüsselung",
        "Chiffrierung",
        "Chiffren",
        "Zertifikat",
    ],
    "Chiffrierung": ["Kryptografie", "kryptografische", "Chiffren", "Verschlüsselung"],
    "Zertifikat": ["Schlüssel", "Kryptografie", "TLS"],
    "Schlüssel": ["Zertifikat", "Verschlüsselung", "Kryptografie"],
    "Passwort": ["Kennwort", "Authentisierung", "Anmeldung"],
    "Kennwort": ["Passwort", "Authentisierung"],
    "Authentisierung": [
        "Passwort",
        "Kennwort",
        "Anmeldung",
        "Identität",
        "Mehr-Faktor-Authentisierung",
    ],
    "Mehr-Faktor-Authentisierung": ["Authentisierung", "Zwei-Faktor", "Passwort"],
    "Zwei-Faktor": ["Mehr-Faktor-Authentisierung", "Authentisierung"],
    "Anmeldung": ["Authentisierung", "Passwort", "Zugriff"],
    "Identität": ["Authentisierung", "Kennung", "Anmeldung"],
    "Kennung": ["Identität", "Authentisierung"],
    "Berechtigung": ["Zugriff", "Rolle", "Identität"],
    "Zugriff": ["Berechtigung", "Rolle", "Authentisierung"],
    "Firewall": ["Paketfilter", "Netztrennung", "Filterregeln", "DMZ"],
    "Paketfilter": ["Firewall", "Filterregeln"],
    "Netztrennung": ["Firewall", "DMZ", "Paketfilter"],
    "Filterregeln": ["Firewall", "Paketfilter"],
    "Backup": ["Backups", "Datensicherung", "Wiederherstellung"],
    "Datensicherung": ["Backup", "Backups", "Wiederherstellung"],
    "Wiederherstellung": ["Backup", "Backups", "Datensicherung"],
    "Server": ["IT-System", "Hardening", "Patch", "Update"],
    "Virenschutz": ["Antivirus", "Malware", "Patch"],
    "Patch": ["Update", "Server"],
    "Update": ["Patch", "Server"],
    "Monitoring": ["Protokollierung", "Audit"],
    "Protokollierung": ["Monitoring", "Audit"],
    "Webseite": ["Webseiten", "Webanwendung", "HTTPS", "TLS"],
    "Webanwendung": ["Webseite", "Webseiten", "HTTPS", "TLS"],
    "Übertragung": ["TLS", "HTTPS", "Verschlüsselung", "Webseite"],
}

# Gestemmte Form für die Query-Expansion (Keys und Werte)
_DOMAIN_SYNONYMS_STEMMED = {
    _stem_word(k): [_stem_word(s) for s in v] for k, v in DOMAIN_SYNONYMS.items()
}


@dataclass
class Chunk:
    """Ein Textabschnitt mit Metadaten (inkl. BSI-Struktur)."""

    text: str
    source: str = ""  # z.B. "BSI_CON_1_Kryptokonzept.pdf"
    chunk_index: int = 0  # laufende Nummer innerhalb der Quelle
    section: str = ""  # Überschrift/Kapitel oder Anforderungs-Titel
    baustein: str = ""  # z.B. "CON.1"
    layer: str = ""  # Themenfeld-Code, z.B. "CON"
    requirement_id: str = ""  # z.B. "CON.1.A1"
    priority: str = ""  # MUSS / SOLLTE / KANN
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "text": self.text,
            "source": self.source,
            "chunk_index": self.chunk_index,
            "section": self.section,
            "baustein": self.baustein,
            "layer": self.layer,
            "requirement_id": self.requirement_id,
            "priority": self.priority,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Chunk":
        return cls(
            text=d["text"],
            source=d.get("source", ""),
            chunk_index=d.get("chunk_index", 0),
            section=d.get("section", ""),
            baustein=d.get("baustein", ""),
            layer=d.get("layer", ""),
            requirement_id=d.get("requirement_id", ""),
            priority=d.get("priority", ""),
            metadata=d.get("metadata", {}),
        )


def _tail_at_word_boundary(text: str, length: int) -> str:
    """Letzte ``length`` Zeichen, an einer Wortgrenze abgeschnitten."""
    if length <= 0 or len(text) <= length:
        return text
    window = text[-length:]
    space = window.find(" ")
    return window[space + 1 :] if space > 0 else window


def chunk_text(
    text: str,
    source: str = "",
    max_chars: int = 400,
    overlap: int = 100,
) -> list[Chunk]:
    """Zerlegt Text in Chunks an Absatzgrenzen und erkennt BSI-Struktur.

    Erkannt werden Anforderungs-IDs (``CON.1.A1`` -> requirement_id, Baustein,
    Priorität), Baustein-IDs (``CON.1`` -> baustein + layer) und Überschriften
    (``section``). Die Metadaten werden zustandsbehaftet auf alle folgenden
    Chunks vererbt, bis eine neue Anforderung beginnt — ein Anforderungstext
    verteilt sich oft über mehrere Absätze.

    Strategie: erst an doppelten Zeilenumbrüchen (Absätze) splitten, dann
    Absätze zu Chunks zusammenfassen, bis ``max_chars`` erreicht ist. Sehr
    lange Absätze werden hart getrennt. Der Overlap verhindert, dass Sinn an
    den Chunk-Grenzen verloren geht (an Wortgrenzen geschnitten).
    """
    text = re.sub(r"\r\n?", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]

    # Baustein aus dem Dokument-Titel vorab bestimmen
    title_match = _BAUSTEIN_ID.search(text)
    current_baustein = title_match.group(1) if title_match else ""
    current_req = ""
    current_prio = ""
    current_section = ""

    chunks: list[Chunk] = []
    current = ""

    def _make(text_part: str) -> Chunk:
        layer = current_baustein.split(".")[0] if current_baustein else ""
        return Chunk(
            text=text_part.strip(),
            source=source,
            chunk_index=len(chunks),
            section=current_section,
            baustein=current_baustein,
            layer=layer,
            requirement_id=current_req,
            priority=current_prio,
        )

    def _flush() -> None:
        nonlocal current
        if current.strip():
            chunks.append(_make(current))
        current = ""

    for para in paragraphs:
        # Anforderungs-ID? -> Baustein, Anforderung, Priorität neu setzen
        req = _REQ_ID.search(para)
        if req:
            # Chunk nicht über Anforderungsgrenzen hinweg mischen
            _flush()
            current_baustein = req.group(1)
            current_req = f"{req.group(1)}.A{req.group(2)}"
            pm = _REQ_PRIORITY.search(para) or _ANY_PRIORITY.search(para)
            current_prio = pm.group(1) if pm else ""
            current_section = para.split("\n", 1)[0][:120]
        elif _is_heading(para):
            current_section = para[:120]
        elif not current_baustein:
            bm = _BAUSTEIN_ID.search(para)
            if bm:
                current_baustein = bm.group(1)

        # Einzelner Absatz zu lang -> hart splitten
        while len(para) > max_chars:
            _flush()
            part, para = para[:max_chars], para[max_chars:]
            chunks.append(_make(part))
        if not current:
            current = para
        elif len(current) + len(para) + 2 <= max_chars:
            current = current + "\n\n" + para
        else:
            _flush()
            # Overlap: Tail des vorherigen Chunks an Wortgrenze mitnehmen
            tail = _tail_at_word_boundary(current, overlap)
            current = (tail + "\n\n" + para) if tail else para
    _flush()
    return chunks


class SemanticEmbedder:
    """Lokale Embedding-Pipeline: TF-IDF + SVD (Latent Semantic Analysis).

    Wird auf dem eigenen Korpus trainiert (``fit``) und erzeugt danach für
    beliebige Texte semantische Vektoren. Keine vortrainierten Modelle nötig
    — die "Semantik" entsteht aus den Worthäufigkeiten im Korpus: Wörter, die
    in ähnlichen Kontexten vorkommen (z.B. "Verschlüsselung" und
    "Kryptografie"), landen in ähnlichen Regionen des Vektorraums.
    """

    def __init__(self, n_components: int = EMBEDDING_DIMS):
        self.n_components = n_components
        self._vectorizer: TfidfVectorizer | None = None
        self._svd: TruncatedSVD | None = None
        # Wort-Vektoren für Query-Expansion (Vokabular -> latenter Raum)
        self._vocab: np.ndarray | None = None
        self._word_vecs: np.ndarray | None = None
        self._doc_freq: np.ndarray | None = None  # Dokumentfrequenz pro Begriff

    @property
    def is_fitted(self) -> bool:
        return self._vectorizer is not None

    def fit(self, texts: list[str]) -> None:
        """Trainiert Vectorizer + SVD auf dem Korpus."""
        self._vectorizer = TfidfVectorizer(
            tokenizer=_tokenize,  # mit deutschem Stemming + Stopword-Filter
            token_pattern=None,  # bei custom tokenizer nicht nötig
            lowercase=False,  # _tokenize lowercased bereits
            stop_words=None,  # Stopwords werden in _tokenize gefiltert
            ngram_range=(1, 2),  # auch "TLS 1.2", "BSI Grundschutz"
            max_features=50_000,
            min_df=1,
            sublinear_tf=True,
            norm="l2",
        )
        tfidf = self._vectorizer.fit_transform(texts)
        # SVD braucht genug Samples/Features; bei sehr kleinem Korpus Fallback
        # auf reines TF-IDF (volle Dimension, ohne Dimensionsreduktion).
        if tfidf.shape[0] < 3 or tfidf.shape[1] < 3:
            self._svd = None
            self._vocab = None
            self._word_vecs = None
            self._doc_freq = None
            return
        # Dokumentfrequenz pro Begriff — steuert die Query-Expansion
        self._doc_freq = np.asarray((tfidf > 0).sum(axis=0)).ravel()
        # LSA braucht deutlich mehr Dokumente als Dimensionen — sonst bleibt
        # der Raum near-identity und die Semantik kollabiert. Faustregel: ein
        # Viertel so viele Dimensionen wie Chunks, damit latente Themen
        # (z.B. "TLS" + "kryptografische Verfahren" -> Krypto-Cluster)
        # zusammenfallen. Bei großen Korpora greift der Default EMBEDDING_DIMS.
        n_comp = max(2, min(self.n_components, tfidf.shape[0] // 4, tfidf.shape[1] - 1))
        self._svd = TruncatedSVD(n_components=n_comp, random_state=42)
        self._svd.fit(tfidf)
        # Wort-Vektoren: Jede Vokabular-Zeile bekommt einen latenten Vektor.
        # Basis für die semantische Query-Expansion (Synonym-Findung).
        self._vocab = self._vectorizer.get_feature_names_out()
        word_vecs = np.asarray(self._svd.components_.T)  # (n_features, n_dims)
        norms = np.linalg.norm(word_vecs, axis=1, keepdims=True)
        self._word_vecs = word_vecs / np.maximum(norms, 1e-12)

    def transform(self, texts: list[str]) -> np.ndarray:
        """Wandelt Texte in semantische Vektoren um (n_texts, n_dims)."""
        if self._vectorizer is None:
            raise RuntimeError("Embedder ist nicht trainiert — zuerst fit() aufrufen.")
        tfidf = self._vectorizer.transform(texts)
        if self._svd is None:
            return np.asarray(tfidf.toarray())
        return self._svd.transform(tfidf)

    def expand_query(self, query: str, max_terms: int = 8, per_term: int = 2) -> str:
        """Erweitert die Query um verwandte Begriffe (Synonym-Matching).

        Zwei Stufen, ohne externes Modell:

        1. **Kuratierte Domänen-Synonyme** (``DOMAIN_SYNONYMS``): hohe
           Präzision, immer aktiv. Schließen Stemmer-Lücken wie
           "Verschlüsselung" vs "verschlüsselt" oder "Backup" vs "Backups".
        2. **Korpus-gelernte Begriffe**: Jeder Query-Begriff bekommt einen
           Vektor im latenten Raum; die ähnlichsten Vokabular-Begriffe werden
           angehängt. Nur Begriffe mit Dokumentfrequenz >= 2 werden
           expandiert — ein Begriff aus nur einem Dokument hätte nur dessen
           eigenes Vokabular als "Synonyme" (selbstreferenzielles Rauschen).

        Beispiel: "TLS" -> "Verschlüsselung, Kryptografie, Zertifikat, HTTPS"
        — dadurch findet die Suche auch Texte, die das Wort nicht wörtlich
        enthalten (z.B. Confluence-Maßnahme "TLS 1.2" -> BSI-Baustein CON.1).
        """
        tokens = _tokenize(query)
        if not tokens:
            return query
        all_tokens = list(dict.fromkeys(tokens))

        extra: list[str] = []
        # Stufe 1: kuratierte Domänen-Synonyme (unabhängig vom SVD-Modell,
        # funktioniert auch im TF-IDF-Fallback bei sehr kleinen Korpora)
        for term in all_tokens:
            for syn in _DOMAIN_SYNONYMS_STEMMED.get(term, []):
                if syn not in all_tokens and syn not in extra and len(syn) >= 3:
                    extra.append(syn)
            if len(extra) >= max_terms:
                break

        # Stufe 2: aus dem Korpus gelernte Begriffe (df >= 2, braucht SVD)
        if (
            len(extra) < max_terms
            and self._svd is not None
            and self._word_vecs is not None
            and self._vocab is not None
            and self._doc_freq is not None
        ):
            vocab_index = {t: i for i, t in enumerate(self._vocab)}
            present = [t for t in all_tokens if t in vocab_index]
            if not present:
                return query if not extra else query + " " + " ".join(extra)
            expandable = [t for t in present if self._doc_freq[vocab_index[t]] >= 2]
            expandable.sort(key=lambda t: -int(self._doc_freq[vocab_index[t]]))
            for term in expandable:
                w_vec = self._word_vecs[vocab_index[term]]
                sims = self._word_vecs @ w_vec
                order = np.argsort(sims)[::-1]
                added = 0
                for idx in order:
                    cand = str(self._vocab[idx])
                    # Nur Unigramme (keine Bigram-Phrasen), keine Query-Begriffe,
                    # Mindestlänge und df >= 2 gegen Rauschen
                    if (
                        " " in cand
                        or cand in all_tokens
                        or cand in extra
                        or len(cand) < 4
                        or self._doc_freq[idx] < 2
                    ):
                        continue
                    extra.append(cand)
                    added += 1
                    if added >= per_term or len(extra) >= max_terms:
                        break
                if len(extra) >= max_terms:
                    break

        if not extra:
            return query
        return query + " " + " ".join(extra)

    @property
    def n_dims(self) -> int:
        if self._svd is not None:
            return self._svd.n_components
        if self._vectorizer is not None:
            return len(self._vectorizer.vocabulary_)
        return 0

    def save(self, path: Path) -> None:
        with open(path, "wb") as f:
            pickle.dump(self, f)

    @classmethod
    def load(cls, path: Path) -> "SemanticEmbedder":
        with open(path, "rb") as f:
            obj = pickle.load(f)
        if not isinstance(obj, cls):
            raise TypeError(f"{path} enthält kein SemanticEmbedder-Objekt")
        return obj


def _chunk_field(chunk: Chunk, key: str):
    """Liest ein Metadaten-Feld (Dataclass-Attribut oder metadata-Dict)."""
    if hasattr(chunk, key):
        return getattr(chunk, key)
    return chunk.metadata.get(key)


class ContextDB:
    """Semantische Vektordatenbank für Regelwerks-Chunks.

    Speichert Chunks + Embeddings persistent in ``persist_dir`` (default:
    ``context_db/``). Suche per Cosine Similarity — Bedeutung statt Buchstaben.

    Beispiel:
        db = ContextDB()
        db.add_chunks(chunk_text(bsi_text, source="CON.1.pdf"))
        db.save()
        hits = db.search("Verschlüsselung von Daten", top_k=3)
        nur_krypto = db.search("Verschlüsselung", filter={"layer": "CON"})
    """

    def __init__(self, persist_dir: str | Path = "context_db"):
        self.persist_dir = Path(persist_dir)
        self.embedder = SemanticEmbedder()
        self.chunks: list[Chunk] = []
        self._vectors: np.ndarray | None = None

    def add_chunks(self, chunks: list[Chunk]) -> int:
        """Fügt Chunks hinzu und trainiert das Embedding-Modell neu.

        SVD ist nicht inkrementell — bei jedem Batch wird neu trainiert. Für
        den Anwendungsfall (nächtlicher Rebuild aus PDFs/DOCX) ist das
        unkritisch und liefert bessere Qualität als Online-Updates.
        """
        self.chunks.extend(chunks)
        self._retrain()
        return len(chunks)

    def _retrain(self) -> None:
        if not self.chunks:
            self._vectors = None
            return
        texts = [c.text for c in self.chunks]
        self.embedder.fit(texts)
        self._vectors = self.embedder.transform(texts)

    def search(
        self,
        query: str,
        top_k: int = 5,
        min_score: float = 0.0,
        expand: bool = True,
        filter: dict | None = None,
    ) -> list[dict]:
        """Semantische Suche: Bedeutung der Anfrage gegen alle Chunks.

        ``expand=True`` (default) reichert die Query vorab mit verwandten
        Begriffen an (Synonym-Matching, siehe ``SemanticEmbedder.expand_query``).

        ``filter`` schränkt auf Metadaten ein, z.B. ``{"layer": "CON"}``,
        ``{"baustein": "CON.1"}`` oder ``{"priority": "MUSS"}``.

        Returns Liste von Treffern, absteigend nach Similarity:
        ``[{"score": 0.87, "text": ..., "source": ..., "baustein": ..., ...}]``
        """
        if self._vectors is None or not self.chunks or self._vectors.size == 0:
            return []
        q = self.embedder.expand_query(query) if expand else query
        q_vec = self.embedder.transform([q])
        sims = cosine_similarity(q_vec, self._vectors)[0]
        order = np.argsort(sims)[::-1]
        results = []
        for idx in order:
            if len(results) >= top_k:
                break
            score = float(sims[idx])
            if score < min_score:
                continue
            chunk = self.chunks[int(idx)]
            if filter and not all(
                _chunk_field(chunk, k) == v for k, v in filter.items()
            ):
                continue
            results.append(
                {
                    "score": round(score, 4),
                    "text": chunk.text,
                    "source": chunk.source,
                    "section": chunk.section,
                    "chunk_index": chunk.chunk_index,
                    "baustein": chunk.baustein,
                    "layer": chunk.layer,
                    "requirement_id": chunk.requirement_id,
                    "priority": chunk.priority,
                    **chunk.metadata,
                }
            )
        return results

    def save(self) -> None:
        """Persistiert Vektoren, Chunks und Embedder nach ``persist_dir``."""
        self.persist_dir.mkdir(parents=True, exist_ok=True)
        vectors = (
            self._vectors
            if self._vectors is not None and self._vectors.size
            else np.empty((0, 0))
        )
        np.save(self.persist_dir / "vectors.npy", vectors)
        with open(self.persist_dir / "chunks.json", "w", encoding="utf-8") as f:
            json.dump(
                [c.to_dict() for c in self.chunks], f, ensure_ascii=False, indent=2
            )
        self.embedder.save(self.persist_dir / "embedder.pkl")

    def load(self) -> bool:
        """Lädt DB aus ``persist_dir``. Returnt False, wenn keine DB existiert."""
        if not (self.persist_dir / "vectors.npy").exists():
            return False
        self._vectors = np.load(self.persist_dir / "vectors.npy")
        with open(self.persist_dir / "chunks.json", encoding="utf-8") as f:
            self.chunks = [Chunk.from_dict(d) for d in json.load(f)]
        self.embedder = SemanticEmbedder.load(self.persist_dir / "embedder.pkl")
        return True

    def clear(self) -> None:
        """Verwirft alle Chunks und Vektoren (für --rebuild)."""
        self.chunks = []
        self._vectors = None
        self.embedder = SemanticEmbedder()

    def stats(self) -> dict:
        return {
            "chunks": len(self.chunks),
            "dims": self.embedder.n_dims,
            "sources": sorted({c.source for c in self.chunks}),
            "layers": sorted({c.layer for c in self.chunks if c.layer}),
            "bausteine": sorted({c.baustein for c in self.chunks if c.baustein}),
            "priorities": sorted({c.priority for c in self.chunks if c.priority}),
            "persist_dir": str(self.persist_dir),
        }
