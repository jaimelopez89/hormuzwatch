ESCALATION_TERMS = [
    "seize", "seized", "attack", "attacked", "intercept", "closure",
    "close", "threat", "threatens", "sanctions", "blockade", "missile",
    "military", "IRGC", "confrontation", "detained", "hostile",
]
DEESCALATION_TERMS = [
    "agreement", "diplomatic", "ease", "eased", "de-escalate", "calm",
    "negotiation", "ceasefire", "withdraw", "release", "resolve",
]

def score_sentiment(text: str) -> int:
    t = text.lower()
    score = 0
    for term in ESCALATION_TERMS:
        if term.lower() in t:
            score -= 1
    for term in DEESCALATION_TERMS:
        if term.lower() in t:
            score += 1
    return score
