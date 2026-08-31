"""
Core recommendation engine.

This is your round-1 model (TF-IDF + SGDClassifier), upgraded from plain
corpus-wide cosine similarity to classify -> retrieve-within-class, which is
what pushed the match rate from ~70-80% up to ~100% on your leaderboard.

Flow for a free-text query (e.g. "I want to learn backend APIs with Python"):
  1. Vectorize the query with the same TF-IDF vectorizer used at training time.
  2. Predict the most likely course with the classifier.
  3. Retrieve the top-N most similar training reviews *within that course only*.
  4. Return the parent course + nearby courses (via classifier's decision
     scores) as "you may also like" for the catalog metadata step.
"""
import os
import joblib
import numpy as np
import pandas as pd
from sklearn.metrics.pairwise import cosine_similarity

from app.config import DATA_DIR

_vectorizer = None
_classifier = None
_train_df = None


def _load():
    global _vectorizer, _classifier, _train_df
    if _vectorizer is None:
        _vectorizer = joblib.load(os.path.join(DATA_DIR, "vectorizer.pkl"))
        _classifier = joblib.load(os.path.join(DATA_DIR, "classifier.pkl"))
        _train_df = pd.read_csv(os.path.join(DATA_DIR, "train.csv"))
        _train_df["Reviews"] = _train_df["Reviews"].fillna("").astype(str)
    return _vectorizer, _classifier, _train_df


def predict_course(text: str) -> str:
    vectorizer, classifier, _ = _load()
    vec = vectorizer.transform([text])
    return classifier.predict(vec)[0]


def top_related_courses(text: str, top_k: int = 5) -> list[str]:
    """Use the classifier's per-class decision scores to rank related courses,
    not just the single best match — useful for 'you may also like'."""
    vectorizer, classifier, _ = _load()
    vec = vectorizer.transform([text])
    scores = classifier.decision_function(vec)[0]
    ranked_idx = np.argsort(scores)[::-1][:top_k]
    return [classifier.classes_[i] for i in ranked_idx]


def similar_reviews_within_course(text: str, course: str, top_k: int = 5) -> list[int]:
    vectorizer, classifier, train_df = _load()
    subset = train_df[train_df["Course"] == course]
    sub_vecs = vectorizer.transform(subset["Reviews"])
    qvec = vectorizer.transform([text])
    sims = cosine_similarity(qvec, sub_vecs)[0]
    top_local = np.argsort(sims)[::-1][:top_k]
    return subset.iloc[top_local]["Index"].tolist()
