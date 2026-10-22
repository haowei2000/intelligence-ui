#!/usr/bin/env python3
"""Intelligence UI reference Agent in Python (standard library only).

It never imports JavaScript. It reads the deployment contract over HTTP, adds the generated
instructions to its own prompt, submits candidates, repairs them from diagnostics, publishes,
and reacts to interaction events through the event log.

Model: set AI_BASE_URL, AI_MODEL and AI_API_KEY for an OpenAI-compatible chat completions
endpoint. Without them a scripted model runs, which deliberately makes common mistakes first so
the repair loop is visible.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

AGENT_PROMPT = "You plan weekend trips. When the user should choose or confirm something, show an interactive card."


class Service:
    def __init__(self, base_url, token):
        self.base = base_url.rstrip("/") + "/ui"
        self.token = token

    def request(self, method, path, body=None, accept="application/json"):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, method=method, headers={
            "Authorization": f"Bearer {self.token}", "Content-Type": "application/json", "Accept": accept})
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                raw = response.read().decode()
                return response.status, (json.loads(raw) if accept == "application/json" else raw)
        except urllib.error.HTTPError as error:
            raw = error.read().decode()
            try:
                return error.code, json.loads(raw)
            except ValueError:
                return error.code, {"error": raw}


def log(*parts):
    print("[agent]", *parts, file=sys.stderr, flush=True)


def first_card():
    return {
        "schemaVersion": "1.0",
        "title": "Trip plan",
        "root": {"type": "Card", "id": "trip-card", "title": "Plan your weekend", "children": [
            {"type": "Image", "id": "cover", "src": "https://images.example.com/berlin.jpg", "alt": "Brandenburg Gate at dusk"},
            {"type": "Link", "id": "guide", "href": "https://example.com/guide", "label": "Read the travel guide"},
            {"type": "Form", "id": "trip-form", "submitAction": "submit-plan", "children": [
                {"type": "Choice", "id": "destination-choice", "bind": "destination", "label": "Destination", "mode": "single",
                 "display": "buttons", "default": "berlin", "required": True,
                 "options": [{"value": "berlin", "label": "Berlin"}, {"value": "paris", "label": "Paris"}]},
                {"type": "Choice", "id": "activities-choice", "bind": "activities", "label": "Activities", "mode": "multiple",
                 "display": "checkbox", "minSelected": 1,
                 "options": [{"value": "museums", "label": "Museums"}, {"value": "food", "label": "Food tour"}, {"value": "cycling", "label": "Cycling"}]},
                {"type": "Slider", "id": "budget-slider", "bind": "budget", "label": "Budget (EUR)", "min": 100, "max": 2000, "step": 50, "default": 600},
                {"type": "Button", "id": "submit-trip", "label": "Continue", "action": {"type": "submit"}}
            ]}
        ]}
    }


def follow_up_card(values):
    """Revision 2: same form and bind keys (so input is preserved), plus results."""
    card = first_card()
    city = values.get("destination") or "berlin"
    card["root"]["title"] = f"Your {city.title()} weekend"
    card["datasets"] = {"hotels": {"rows": [
        {"name": "Hotel Central", "price": 180, "rating": 4.6},
        {"name": "City Hostel", "price": 45, "rating": 4.1}]}}
    card["root"]["children"].append({"type": "Table", "id": "hotels", "dataset": "hotels", "rowKey": "name", "sortable": True,
        "caption": f"Hotels in {city.title()}", "columns": [
            {"field": "name", "label": "Hotel"}, {"field": "price", "label": "Price (EUR)", "format": "number"},
            {"field": "rating", "label": "Rating", "format": "number"}]})
    card["root"]["children"].append({"type": "Button", "id": "refresh", "label": "Refresh prices", "action": {"type": "action", "actionId": "refresh-prices"}})
    return card


class ScriptedModel:
    """Stands in for a model: the first answer contains typical generation errors."""

    def __init__(self):
        self.turn = 0

    def complete(self, messages):
        self.turn += 1
        last = messages[-1]["content"]
        if self.turn == 1:
            card = first_card()
            form = card["root"]["children"][2]
            form["submitAction"] = "book-trip"                     # not registered by this host
            form["children"][2]["min"] = "100"                     # number as string (deterministic fix)
            form["children"][0]["display"] = "Buttons"             # wrong case (deterministic fix)
            card["root"]["children"].insert(0, {"type": "Row", "id": "header", "children": []})  # unknown component
            return "```json\n" + json.dumps(card) + "\n```"
        if last.startswith("The UI document was rejected"):
            candidate = json.loads(messages[-2]["content"])
            # A model would reason over the feedback; the script applies the diagnostics' own guidance.
            for diagnostic in json.loads(messages[-1]["diagnostics"]):
                if diagnostic["code"] == "UNREGISTERED_ACTION":
                    allowed = diagnostic.get("alternatives") or diagnostic["expected"]["allowed"]
                    apply_pointer(candidate, diagnostic["path"], next((a for a in allowed if "submit" in a), allowed[0]))
                if diagnostic["code"] == "UNKNOWN_COMPONENT" and diagnostic.get("proposedPatch"):
                    for op in diagnostic["proposedPatch"]:
                        apply_pointer(candidate, op["path"], op["value"])
            return json.dumps(candidate)
        return json.dumps(follow_up_card(json.loads(last).get("values", {})))


class ChatModel:
    def __init__(self, base_url, model, api_key):
        self.base_url, self.model, self.api_key = base_url.rstrip("/"), model, api_key

    def complete(self, messages):
        body = json.dumps({"model": self.model, "messages": [{"role": m["role"], "content": m["content"]} for m in messages]}).encode()
        req = urllib.request.Request(self.base_url + "/chat/completions", data=body, method="POST",
                                     headers={"Content-Type": "application/json", "Authorization": f"Bearer {self.api_key}"})
        with urllib.request.urlopen(req, timeout=120) as response:
            return json.loads(response.read())["choices"][0]["message"]["content"]


def apply_pointer(document, pointer, value):
    parts = [p.replace("~1", "/").replace("~0", "~") for p in pointer.split("/")[1:]]
    target = document
    for part in parts[:-1]:
        target = target[int(part)] if isinstance(target, list) else target[part]
    key = parts[-1]
    if isinstance(target, list):
        target[int(key)] = value
    else:
        target[key] = value


def generate(service, model, messages, max_repairs=2):
    """Generate, fix deterministically on the service, repair with the model, return a valid document."""
    text = model.complete(messages)
    for attempt in range(max_repairs + 1):
        status, fixed = service.request("POST", "/fix", {"document": text})
        for change in fixed.get("applied", []):
            log(f"autofix {change['rule']} at {change['path'] or '/'}")
        if fixed.get("valid"):
            return fixed["document"]
        errors = [d for d in fixed["diagnostics"] if d["severity"] == "error"]
        log(f"attempt {attempt + 1}: {len(errors)} error(s): " + ", ".join(f"{d['code']} {d['path']}" for d in errors))
        if attempt == max_repairs or fixed.get("candidate") is None:
            break
        feedback = "The UI document was rejected. Fix every error and return the complete JSON document only.\n" + \
            "\n".join(f"- {d['code']} at {d['path']}: {d['message']} {d.get('suggestion', '')}" for d in errors)
        messages = messages + [{"role": "assistant", "content": json.dumps(fixed["candidate"])},
                               {"role": "user", "content": feedback, "diagnostics": json.dumps(errors)}]
        text = model.complete(messages)
    raise RuntimeError("could not produce a valid document")


def publish(service, surface, document_id, document, base_revision, resolves=None):
    body = {"document": document, "baseRevision": base_revision}
    if resolves:
        body["resolvesEventId"] = resolves
    status, result = service.request("PUT", f"/surfaces/{surface}/documents/{document_id}", body)
    if result.get("status") != "committed":
        raise RuntimeError(f"publication {result.get('status')}: {json.dumps(result.get('diagnostics') or result)[:500]}")
    log(f"published {document_id} revision {result['committed']['revision']}")
    return result["committed"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--service", default=os.environ.get("IUI_SERVICE", "http://127.0.0.1:4320"))
    parser.add_argument("--token", default=os.environ.get("IUI_AGENT_TOKEN", "demo-agent-token-change-me"))
    parser.add_argument("--surface", default="demo")
    parser.add_argument("--document", default="trip-plan")
    parser.add_argument("--max-events", type=int, default=0, help="exit after handling this many events (0 = run forever)")
    parser.add_argument("--poll", type=float, default=0.5)
    args = parser.parse_args()

    service = Service(args.service, args.token)
    status, contract = service.request("GET", "/contract")
    if status != 200:
        sys.exit(f"cannot read contract: {status} {contract}")
    status, instructions = service.request("GET", "/instructions", accept="text/markdown")
    log(f"contract {contract['id']} with actions {[a['id'] for a in contract['actions'] or []]}")

    if os.environ.get("AI_BASE_URL") and os.environ.get("AI_MODEL") and os.environ.get("AI_API_KEY"):
        model = ChatModel(os.environ["AI_BASE_URL"], os.environ["AI_MODEL"], os.environ["AI_API_KEY"])
    else:
        model = ScriptedModel()
    system = AGENT_PROMPT + "\n\n" + instructions  # instructions are additive to the Agent's own prompt

    document = generate(service, model, [{"role": "system", "content": system},
                                         {"role": "user", "content": "Help me plan a weekend trip."}])
    committed = publish(service, args.surface, args.document, document, 0)

    cursor, handled = "0", 0
    while args.max_events == 0 or handled < args.max_events:
        status, page = service.request("GET", f"/events?surface={args.surface}&cursor={cursor}")
        if page.get("expired"):
            log("some events expired before they were read")
        for record in page.get("events", []):
            event = record["event"]
            log(f"event {event['actionId']} from {event['sourceId']}: {json.dumps(event['values'])}")
            if event["actionId"] == "submit-plan":
                document = generate(service, model, [{"role": "system", "content": system},
                                                     {"role": "user", "content": json.dumps(event)}])
                committed = publish(service, args.surface, args.document, document, committed["revision"], resolves=event["eventId"])
            else:
                service.request("POST", f"/surfaces/{args.surface}/events/{event['eventId']}/status", {"status": "succeeded", "message": "Prices are current."})
            handled += 1
        cursor = page.get("cursor", cursor)
        if args.max_events == 0 or handled < args.max_events:
            time.sleep(args.poll)
    log("done")


if __name__ == "__main__":
    main()
