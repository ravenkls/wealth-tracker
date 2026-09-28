"""Publish immutable assets before the app shell, then verify the public deployment."""
import json
import subprocess
import time
import urllib.request


def run(*args):
    return subprocess.check_output(args, text=True)


outputs = json.loads(run("terraform", "-chdir=infra", "output", "-json"))
bucket = outputs["web_bucket"]["value"]
distribution = outputs["distribution_id"]["value"]
origin = outputs["site_url"]["value"]
run("aws", "s3", "sync", "apps/web/dist/assets", f"s3://{bucket}/assets", "--cache-control", "public,max-age=31536000,immutable", "--only-show-errors")
run("aws", "s3", "sync", "apps/web/dist", f"s3://{bucket}", "--exclude", "assets/*", "--exclude", "index.html", "--cache-control", "no-cache", "--only-show-errors")
run("aws", "s3", "cp", "apps/web/dist/index.html", f"s3://{bucket}/index.html", "--cache-control", "no-cache", "--content-type", "text/html", "--only-show-errors")
invalidation = json.loads(run("aws", "cloudfront", "create-invalidation", "--distribution-id", distribution, "--paths", "/*"))
run("aws", "cloudfront", "wait", "invalidation-completed", "--distribution-id", distribution, "--id", invalidation["Invalidation"]["Id"])
for attempt in range(12):
    try:
        with urllib.request.urlopen(origin, timeout=20) as response:
            assert response.status == 200 and 'id="root"' in response.read().decode()
        with urllib.request.urlopen(origin + "/api/trpc/health", timeout=20) as response:
            health = json.load(response)["result"]["data"]
            assert health["database"] == "ready", health
        with urllib.request.urlopen(origin + "/api/trpc/session", timeout=20) as response:
            assert json.load(response)["result"]["data"] is None
        print(f"Deployment verified: {origin}")
        break
    except Exception:
        if attempt == 11:
            raise
        time.sleep(10)
