# APICenter Uses a Dedicated GCP Project

APICenter infrastructure and payment Pub/Sub live in a dedicated Google Cloud project separate from AlphaCI consumer projects. This keeps gateway IAM, payment topics, secrets, quotas, monitoring, billing, and lifecycle control independent from product deployments.

