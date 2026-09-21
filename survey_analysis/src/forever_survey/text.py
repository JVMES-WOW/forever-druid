"""Privacy-aware text preprocessing, word-cloud counts, and topic models."""
from __future__ import annotations

import hashlib
import re
from collections import Counter

import numpy as np
import pandas as pd
from scipy.optimize import linear_sum_assignment
from sklearn.decomposition import NMF
from sklearn.feature_extraction.text import CountVectorizer, ENGLISH_STOP_WORDS, TfidfVectorizer

from . import SEED
from .stats import normalize_text


PHRASES = {
    r"power[ -]?shift(?:ing|s|ed)?": "powershifting",
    r"tiger'?s? fury": "tigers_fury",
    r"energy regen(?:eration)?": "energy_regeneration",
    r"energy pool(?:ing)?": "energy_pooling",
    r"skill expression": "skill_expression",
    r"skill ceiling": "skill_ceiling",
    r"bear weav(?:e|ing)": "bear_weaving",
    r"cat form": "cat_form",
    r"bear form": "bear_form",
    r"combo points?": "combo_points",
    r"weapon scal(?:e|es|ing)": "weapon_scaling",
    r"raid utilit(?:y|ies)": "raid_utility",
    r"clear ?casting|omen of clarity": "clearcasting",
    r"wolfshead helm": "wolfshead_helm",
    r"shapeshift(?:ing)? identity": "shapeshifting_identity",
}

CUSTOM_STOP = set(ENGLISH_STOP_WORDS) | {
    "feral", "forever", "current", "currently", "design", "druid", "game",
    "player", "players", "thing", "really", "feel", "feels", "make", "makes",
    "want", "wanted", "like", "would", "just", "dont", "doesnt", "isnt",
    "classic", "wow", "spec", "mechanic", "mechanics", "direction",
}

PHRASE_ANCHORS = {
    "powershifting", "energy", "rotation", "bleed", "bleeds", "furor", "cat", "bear",
    "swipe", "aoe", "gameplay", "skill", "identity", "shapeshifting", "form", "forms",
    "tigers_fury", "clearcasting", "weapon_scaling", "raid_utility", "combo_points",
    "downtime", "apm", "talent", "talents", "damage", "hybrid", "tank", "utility",
    "resource", "resources", "shifting", "buttons", "engaging", "waiting", "activity",
    "mastery", "scaling", "mana", "cooldown", "proc", "procs", "rake", "rip", "berserk",
}


def preprocess(text: object) -> str:
    value = normalize_text(text)
    for pattern, replacement in PHRASES.items():
        value = re.sub(pattern, replacement, value, flags=re.I)
    return value


def display_term(term: str) -> str:
    labels = {
        "tigers_fury": "Tiger's Fury", "energy_regeneration": "energy regeneration",
        "energy_pooling": "energy pooling", "skill_expression": "skill expression",
        "skill_ceiling": "skill ceiling", "bear_weaving": "Bear weaving",
        "cat_form": "Cat form", "bear_form": "Bear form", "combo_points": "combo points",
        "weapon_scaling": "weapon scaling", "raid_utility": "raid utility",
        "clearcasting": "Clearcasting", "wolfshead_helm": "Wolfshead Helm",
        "shapeshifting_identity": "shapeshifting identity",
    }
    return labels.get(term, term.replace("_", " "))


def document_frequency(texts: list[str], limit: int = 120) -> pd.DataFrame:
    """Count distinct-response mentions of meaningful two- and three-word phrases."""
    docs = [preprocess(t) for t in texts if normalize_text(t)]
    vectorizer = CountVectorizer(ngram_range=(2, 3),
                                 binary=True, min_df=max(2, len(docs) // 250),
                                 token_pattern=r"(?u)\b[a-z][a-z0-9_+'/\-]{2,}\b",
                                 max_features=6000)
    counts: Counter[str] = Counter()
    try:
        matrix = vectorizer.fit_transform(docs)
    except ValueError as exc:
        if "no terms remain" not in str(exc).lower() and "empty vocabulary" not in str(exc).lower():
            raise
    else:
        for term, count in zip(vectorizer.get_feature_names_out(), np.asarray(matrix.sum(axis=0)).ravel()):
            tokens = term.split()
            content_tokens = [token for token in tokens if token not in CUSTOM_STOP]
            if (any(token in PHRASE_ANCHORS for token in tokens)
                    and len(set(content_tokens)) > 1
                    and tokens[0] not in CUSTOM_STOP
                    and tokens[-1] not in CUSTOM_STOP):
                counts[term] = int(count)
    # Protected phrases are single vectorizer tokens after preprocessing. Add
    # their binary document counts so they remain intact alongside n-grams.
    for canonical in PHRASES.values():
        count = sum(canonical in set(doc.split()) for doc in docs)
        if count and " " in display_term(canonical):
            counts[canonical] = count
    rows = [{"term": display_term(term), "response_mentions": n,
             "responses_with_text": len(docs), "percent_of_responses": 100 * n / len(docs)}
            for term, n in counts.most_common(limit)]
    return pd.DataFrame(rows)


def _topic_terms(model: NMF, features: np.ndarray, top_n: int = 10) -> list[list[str]]:
    return [[display_term(features[i]) for i in comp.argsort()[-top_n:][::-1]]
            for comp in model.components_]


def _stability(a: np.ndarray, b: np.ndarray) -> float:
    an = a / np.maximum(np.linalg.norm(a, axis=1, keepdims=True), 1e-12)
    bn = b / np.maximum(np.linalg.norm(b, axis=1, keepdims=True), 1e-12)
    similarity = an @ bn.T
    rows, cols = linear_sum_assignment(-similarity)
    return float(similarity[rows, cols].mean())


def candidate_models(texts: list[str], ks=range(4, 11)) -> tuple[pd.DataFrame, dict[int, tuple]]:
    docs = [preprocess(t) for t in texts if normalize_text(t)]
    vectorizer = TfidfVectorizer(stop_words=list(CUSTOM_STOP), ngram_range=(1, 2),
                                 min_df=max(2, len(docs) // 250), max_df=0.92,
                                 sublinear_tf=True, max_features=2500)
    matrix = vectorizer.fit_transform(docs)
    features = vectorizer.get_feature_names_out()
    fitted: dict[int, tuple] = {}
    rows = []
    for k in ks:
        if k >= min(matrix.shape):
            continue
        model = NMF(n_components=k, init="nndsvda", random_state=SEED, max_iter=700,
                    l1_ratio=0.05, alpha_W=0.001, alpha_H="same")
        weights = model.fit_transform(matrix)
        check = NMF(n_components=k, init="nndsvda", random_state=SEED + 17,
                    max_iter=700, l1_ratio=0.05, alpha_W=0.001, alpha_H="same").fit(matrix)
        stability = _stability(model.components_, check.components_)
        terms = _topic_terms(model, features)
        flat = [term for topic in terms for term in topic]
        diversity = len(set(flat)) / len(flat)
        norm = model.components_ / np.maximum(np.linalg.norm(model.components_, axis=1, keepdims=True), 1e-12)
        sim = norm @ norm.T
        redundancy = float(sim[np.triu_indices(k, 1)].max())
        error = float(model.reconstruction_err_ / np.sqrt(matrix.power(2).sum()))
        score = stability + 0.35 * diversity - 0.35 * redundancy - 0.15 * error
        rows.append({"topics": k, "stability": stability, "top_term_diversity": diversity,
                     "max_component_similarity": redundancy, "normalized_reconstruction_error": error,
                     "diagnostic_score": score})
        fitted[k] = (model, weights, vectorizer, terms, docs)
    return pd.DataFrame(rows), fitted


def topic_outputs(texts: list[str], chosen_k: int, labels: list[str]) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    diagnostics, fitted = candidate_models(texts)
    if chosen_k not in fitted:
        raise ValueError(f"Chosen topic count {chosen_k} is unavailable")
    model, weights, vectorizer, terms, docs = fitted[chosen_k]
    if len(labels) != chosen_k:
        raise ValueError("Each topic requires one human-reviewed label")
    primary = weights.argmax(axis=1)
    secondary = np.argsort(weights, axis=1)[:, -2]
    assignments = pd.DataFrame({"document_id": [f"D{i+1:04d}" for i in range(len(docs))],
                                "primary_topic": [labels[i] for i in primary],
                                "secondary_topic": [labels[i] for i in secondary]})
    for i, label in enumerate(labels):
        assignments[f"weight_{i+1}"] = weights[:, i]
    prevalence = pd.DataFrame({"topic": labels,
                               "primary_count": [(primary == i).sum() for i in range(chosen_k)],
                               "documents": len(docs),
                               "soft_weight_share": weights.sum(axis=0) / weights.sum() * 100})
    prevalence["primary_share"] = 100 * prevalence["primary_count"] / len(docs)
    top_terms = pd.DataFrame([{"topic_number": i + 1, "label": labels[i],
                               "top_terms": "; ".join(terms[i])} for i in range(chosen_k)])
    diagnostics["selected"] = diagnostics["topics"].eq(chosen_k)
    return diagnostics, top_terms, prevalence, assignments


def private_text_id(text: str) -> str:
    return hashlib.sha256(normalize_text(text).encode()).hexdigest()[:16]
