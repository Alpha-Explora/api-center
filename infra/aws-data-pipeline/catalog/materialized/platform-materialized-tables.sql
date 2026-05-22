CREATE DATABASE IF NOT EXISTS materialized_platform;

-- Materialized tables are created by scripts/data-pipeline/materialize-silver-gold.ps1.
-- The script creates one bounded Parquet snapshot table per dataset/environment/day.
-- Naming convention:
--
--   materialized_platform.<source_database>_<source_table>_<environment>_<yyyymmdd>
--
-- Example:
--
--   materialized_platform.gold_platform_pipeline_health_daily_prod_20260520
--
-- Output layout:
--
--   s3://api-center-curated-data/<layer>/<dataset>/environment=<env>/year=YYYY/month=MM/day=DD/
--
-- Do not point BI tools at api-center-raw-data/topics/*. BI readers should use
-- approved Gold views or materialized Parquet outputs under api-center-curated-data.
