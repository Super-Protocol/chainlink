import json
import uuid
import datetime
from copy import deepcopy

PROM_DS = {"type": "prometheus", "uid": "${DS_PROMETHEUS}"}

def row(panel_id: int, title: str, y: int) -> dict:
    return {
        "collapsed": False,
        "gridPos": {"h": 1, "w": 24, "x": 0, "y": y},
        "id": panel_id,
        "panels": [],
        "title": title,
        "type": "row",
    }

def stat(
    panel_id: int,
    title: str,
    expr: str,
    unit: str,
    x: int,
    y: int,
    w: int = 6,
    h: int = 4,
    thresholds: list | None = None,
    description: str = "",
) -> dict:
    thresholds = thresholds or [
        {"color": "green", "value": None},
        {"color": "red", "value": 1},
    ]

    return {
        "datasource": PROM_DS,
        "fieldConfig": {
            "defaults": {
                "mappings": [],
                "thresholds": {
                    "mode": "absolute",
                    "steps": thresholds,
                },
                "unit": unit,
            },
            "overrides": [],
        },
        "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "id": panel_id,
        "options": {
            "colorMode": "value",
            "graphMode": "none",
            "justifyMode": "center",
            "orientation": "horizontal",
            "reduceOptions": {
                "calcs": ["lastNotNull"],
                "fields": "",
                "values": False,
            },
            "textMode": "auto",
        },
        "targets": [
            {
                "datasource": PROM_DS,
                "expr": expr,
                "instant": True,
                "interval": "",
                "legendFormat": "",
                "refId": "A",
            }
        ],
        "title": title,
        "description": description,
        "type": "stat",
    }

def timeseries(
    panel_id: int,
    title: str,
    targets: list[dict],
    x: int,
    y: int,
    w: int = 12,
    h: int = 7,
    unit: str = "short",
    stacking: dict | None = None,
    color_mode: str = "palette-classic",
    description: str = "",
) -> dict:
    stacking = stacking or {"group": "A", "mode": "none"}

    panel_targets = []
    for idx, target in enumerate(targets):
        t = {
            "datasource": PROM_DS,
            "expr": target["expr"],
            "interval": target.get("interval", ""),
            "legendFormat": target.get("legend", ""),
            "refId": chr(65 + idx),
        }
        if target.get("instant"):
            t["instant"] = True
        panel_targets.append(t)

    return {
        "datasource": PROM_DS,
        "fieldConfig": {
            "defaults": {
                "color": {"mode": color_mode},
                "custom": {
                    "axisCenteredZero": False,
                    "axisPlacement": "auto",
                    "barAlignment": 0,
                    "drawStyle": "line",
                    "fillOpacity": 10,
                    "gradientMode": "none",
                    "hideFrom": {
                        "legend": False,
                        "tooltip": False,
                        "viz": False,
                    },
                    "lineInterpolation": "linear",
                    "lineWidth": 2,
                    "pointSize": 4,
                    "scaleDistribution": {"type": "linear"},
                    "showPoints": "auto",
                    "spanNulls": False,
                    "stacking": stacking,
                    "thresholdsStyle": {"mode": "off"},
                },
                "mappings": [],
                "thresholds": {
                    "mode": "absolute",
                    "steps": [
                        {"color": "green", "value": None},
                        {"color": "red", "value": None},
                    ],
                },
                "unit": unit,
            },
            "overrides": [],
        },
        "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "id": panel_id,
        "options": {
            "legend": {
                "calcs": [],
                "displayMode": "list",
                "placement": "bottom",
            },
            "tooltip": {"mode": "multi", "sort": "desc"},
        },
        "targets": panel_targets,
        "title": title,
        "description": description,
        "type": "timeseries",
    }

def table(
    panel_id: int,
    title: str,
    targets: list[dict],
    x: int,
    y: int,
    h: int = 8,
    rename: dict | None = None,
    description: str = "",
    exclude_columns: list | None = None,
    field_overrides: list | None = None,
) -> dict:
    rename = rename or {}
    exclude_columns = exclude_columns or []
    field_overrides = field_overrides or []
    panel_targets = []
    for idx, t in enumerate(targets):
        target = {
            "datasource": PROM_DS,
            "expr": t["expr"],
            "format": "table",
            "instant": True,
            "interval": "",
            "legendFormat": "",
            "refId": chr(65 + idx),
        }
        panel_targets.append(target)

    exclude_by_name = {"Time": True}
    for col in exclude_columns:
        exclude_by_name[col] = True

    transformations = [
        {"id": "merge", "options": {}},
        {
            "id": "organize",
            "options": {
                "excludeByName": exclude_by_name,
                "renameByName": rename,
            },
        },
    ]

    return {
        "datasource": PROM_DS,
        "fieldConfig": {
            "defaults": {
                "custom": {"align": "auto", "displayMode": "auto"},
                "mappings": [],
                "thresholds": {
                    "mode": "absolute",
                    "steps": [{"color": "green", "value": None}],
                },
            },
            "overrides": field_overrides,
        },
        "gridPos": {"h": h, "w": 24, "x": x, "y": y},
        "id": panel_id,
        "options": {
            "footer": {"enable": False, "fields": "", "reducer": ["sum"]},
            "showHeader": True,
        },
        "pluginVersion": "10.0.0",
        "targets": panel_targets,
        "title": title,
        "description": description,
        "transformations": transformations,
        "type": "table",
    }

def dashboard_definition() -> dict:
    panels = []
    y = 0

    # 1. Service Overview - Quick pulse to see if service is alive
    panels.append(row(1, "Service Overview", y))
    y += 1
    panels.append(stat(2, "Requests/s", "sum(increase(http_requests_total{job=\"$job\", instance=~\"$instance\"}[$__range])) / $__range_s", "reqps", 0, y, thresholds=[{"color": "red", "value": 0}, {"color": "green", "value": 0.1}], description="Average HTTP requests per second over the selected time range. Should be > 0 if service is receiving traffic."))
    panels.append(stat(3, "Latency P95", "histogram_quantile(0.95, sum(increase(http_request_duration_seconds_bucket{job=\"$job\", instance=~\"$instance\"}[$__range])) by (le))", "s", 6, y, thresholds=[{"color": "green", "value": None}, {"color": "red", "value": 1}], description="95th percentile of HTTP request latency over the selected time range. Values > 1s indicate performance issues."))
    panels.append(stat(4, "Errors/s", "sum(rate(app_errors_total{job=\"$job\", instance=~\"$instance\"}[1m]))", "ops", 12, y, thresholds=[{"color": "green", "value": None}, {"color": "red", "value": 0.1}], description="Application errors per second. Should be 0 or very low in healthy system."))
    panels.append(stat(5, "Uptime", "min(up{job=\"$job\", instance=~\"$instance\"})", "percentunit", 18, y, thresholds=[{"color": "red", "value": None}, {"color": "green", "value": 1}], description="Service availability. 1 = up, 0 = down. All instances should be up."))
    y += 4

    panels.append(timeseries(6, "Request Breakdown", [{"expr": "sum(rate(http_requests_total{job=\"$job\", instance=~\"$instance\"}[1m])) by (route)", "legend": "{{route}}"}], 0, y, w=24, unit="reqps", description="HTTP requests per second broken down by route. Shows which endpoints are being used most."))
    y += 8

    # 2. Cache Health - Core focus: Is cache populated and used?
    panels.append(row(10, "Cache Health", y))
    y += 1
    panels.append(stat(11, "Total Cache Size", "sum(cache_size{job=\"$job\", instance=~\"$instance\", source=~\"$source\"})", "short", 0, y, thresholds=[{"color": "red", "value": 0}, {"color": "green", "value": 1}], description="Total number of cached price entries. Should be > 0 if cache is working."))
    panels.append(stat(12, "Hit Ratio", "sum(increase(cache_hits_total{job=\"$job\", instance=~\"$instance\", source=~\"$source\"}[$__range])) / clamp_min(sum(increase(cache_hits_total{job=\"$job\", instance=~\"$instance\", source=~\"$source\"}[$__range]) + increase(cache_misses_total{job=\"$job\", instance=~\"$instance\", source=~\"$source\"}[$__range])), 0.00001)", "percentunit", 6, y, thresholds=[{"color": "red", "value": None}, {"color": "orange", "value": 0.8}, {"color": "green", "value": 0.95}], description="Cache hit ratio over the entire selected time range. Higher is better. >95% is excellent, <80% indicates cache issues."))
    panels.append(stat(13, "Tracked Pairs", "sum(tracked_pairs_total{job=\"$job\", instance=~\"$instance\"})", "short", 12, y, thresholds=[{"color": "red", "value": 0}, {"color": "green", "value": 1}], description="Number of trading pairs currently being tracked and cached."))
    panels.append(stat(14, "Unique Pairs", "pairs_total{job=\"$job\", instance=~\"$instance\"}", "short", 18, y, thresholds=[{"color": "red", "value": 0}, {"color": "green", "value": 1}], description="Total unique trading pairs configured in the system."))
    y += 4

    panels.append(timeseries(15, "Cache Hits vs Misses", [
        {"expr": "sum(rate(cache_hits_total{job=\"$job\", instance=~\"$instance\", source=~\"$source\"}[1m])) by (source)", "legend": "Hits {{source}}"},
        {"expr": "sum(rate(cache_misses_total{job=\"$job\", instance=~\"$instance\", source=~\"$source\"}[1m])) by (source)", "legend": "Misses {{source}}"}
    ], 0, y, w=12, unit="ops", stacking={"mode": "normal"}, description="Cache hits vs misses per source. More hits = better performance. High misses indicate cache problems."))
    panels.append(timeseries(16, "Cache Size Trend", [{"expr": "sum(cache_size{job=\"$job\", instance=~\"$instance\", source=~\"$source\"}) by (source)", "legend": "{{source}}"}], 12, y, w=12, unit="short", stacking={"mode": "normal"}, description="Number of cached entries over time by source. Should grow initially then stabilize."))
    y += 8

    # 3. Update Mechanisms - Are prices updating?
    panels.append(row(20, "Update Mechanisms", y))
    y += 1
    panels.append(stat(21, "Max Staleness", "max(time() - source_last_successful_update_timestamp{job=\"$job\", instance=~\"$instance\", source=~\"$source\", pair=~\"$pair\"})", "s", 0, y, thresholds=[{"color": "green", "value": None}, {"color": "red", "value": 300}], description="Maximum time since last successful price update. >300s indicates stale data."))
    panels.append(stat(22, "WS Connections", "sum(websocket_connections_total{job=\"$job\", instance=~\"$instance\", source=~\"$source\"})", "short", 6, y, thresholds=[{"color": "green", "value": None}, {"color": "red", "value": 0}], description="Active WebSocket connections to price sources. Should be > 0 for real-time updates."))
    panels.append(stat(23, "WS Messages/s", "sum(rate(websocket_messages_received_total{job=\"$job\", instance=~\"$instance\", source=~\"$source\"}[1m]))", "ops", 12, y, thresholds=[{"color": "green", "value": None}, {"color": "red", "value": 0}], description="WebSocket messages received per second. Indicates real-time data flow."))
    panels.append(stat(24, "Quotes Processed/s", "sum(rate(quotes_processed_total{job=\"$job\", instance=~\"$instance\", source=~\"$source\", status=\"success\"}[1m]))", "ops", 18, y, thresholds=[{"color": "green", "value": None}, {"color": "red", "value": 0}], description="Successfully processed price quotes per second. Should be > 0 for active trading pairs."))
    y += 4

    panels.append(timeseries(25, "Update Frequency P95", [{"expr": "histogram_quantile(0.95, sum(rate(price_update_frequency_seconds_bucket{job=\"$job\", instance=~\"$instance\", source=~\"$source\", pair=~\"$pair\"}[1m])) by (le, source))", "legend": "{{source}}"}], 0, y, w=12, unit="s", description="95th percentile of price update intervals by source. Lower is better for real-time data."))
    panels.append(timeseries(26, "Staleness Trend", [{"expr": "avg(time() - source_last_successful_update_timestamp{job=\"$job\", instance=~\"$instance\", source=~\"$source\", pair=~\"$pair\"}) by (source)", "legend": "{{source}}"}], 12, y, w=12, unit="s", description="Average staleness of price data by source. Should be low and stable."))
    y += 8

    staleness_field_overrides = [
        {
            "matcher": {"id": "byName", "options": "Staleness (s)"},
            "properties": [
                {
                    "id": "thresholds",
                    "value": {
                        "mode": "absolute",
                        "steps": [
                            {"color": "green", "value": None},
                            {"color": "yellow", "value": 10},
                            {"color": "red", "value": 60}
                        ]
                    }
                },
                {
                    "id": "custom.cellOptions",
                    "value": {"type": "color-background"}
                }
            ]
        }
    ]
    panels.append(table(27, "Staleness by Pair", [{"expr": "time() - source_last_successful_update_timestamp{job=\"$job\", instance=~\"$instance\", source=~\"$source\", pair=~\"$pair\"}"}], 0, y, h=8, rename={"Value": "Staleness (s)", "source": "Source", "pair": "Pair"}, description="Staleness of each trading pair by source. Green <10s, Yellow 10-60s, Red >60s.", exclude_columns=["instance", "job"], field_overrides=staleness_field_overrides))
    y += 9

    # 4. Source Reliability - Why might cache be stale?
    panels.append(row(30, "Source Reliability", y))
    y += 1
    panels.append(timeseries(31, "API Errors", [{"expr": "sum(rate(source_api_errors_total{job=\"$job\", instance=~\"$instance\", source=~\"$source\"}[1m])) by (source)", "legend": "{{source}}"}], 0, y, w=12, unit="ops", description="API errors per second by source. Should be 0 or very low. High values indicate source problems."))
    panels.append(timeseries(32, "Rate Limit Hits", [{"expr": "sum(rate(rate_limit_hits_total{job=\"$job\", instance=~\"$instance\", source=~\"$source\"}[1m])) by (source)", "legend": "{{source}}"}], 12, y, w=12, unit="ops", description="Rate limit hits per second by source. High values may cause data staleness."))
    y += 8

    panels.append(timeseries(33, "Fetch Latency P95", [{"expr": "histogram_quantile(0.95, sum(rate(source_fetch_duration_seconds_bucket{job=\"$job\", instance=~\"$instance\", source=~\"$source\"}[1m])) by (le, source))", "legend": "{{source}}"}], 0, y, w=12, unit="s", description="95th percentile of API fetch latency by source. High values may indicate network or source issues."))
    panels.append(timeseries(34, "Price Not Found", [{"expr": "sum(rate(price_not_found_total{job=\"$job\", instance=~\"$instance\", source=~\"$source\", pair=~\"$pair\"}[1m])) by (source)", "legend": "{{source}}"}], 12, y, w=12, unit="ops", description="Rate of price not found errors by source. May indicate missing trading pairs on source."))
    y += 8

    # 5. Runtime Metrics - Basic resource usage
    panels.append(row(40, "Runtime Metrics", y))
    y += 1
    panels.append(timeseries(41, "CPU Usage", [{"expr": "rate(nodejs_process_cpu_seconds_total{job=\"$job\", instance=~\"$instance\"}[1m]) * 100", "legend": "CPU %"}], 0, y, w=12, unit="percent", description="CPU usage percentage. High sustained values may indicate performance bottlenecks."))
    panels.append(timeseries(42, "Memory Usage", [{"expr": "nodejs_process_resident_memory_bytes{job=\"$job\", instance=~\"$instance\"}", "legend": "RSS"}], 12, y, w=12, unit="bytes", description="Resident memory usage. Steady growth may indicate memory leaks."))
    y += 8

    panels.append(timeseries(43, "Event Loop Lag P99", [{"expr": "nodejs_nodejs_eventloop_lag_p99_seconds{job=\"$job\", instance=~\"$instance\"}", "legend": "Lag P99"}], 0, y, w=12, unit="s", description="99th percentile of event loop lag. High values indicate blocking operations affecting responsiveness."))
    panels.append(timeseries(44, "GC Duration P95", [{"expr": "histogram_quantile(0.95, sum(rate(nodejs_nodejs_gc_duration_seconds_bucket{job=\"$job\", instance=~\"$instance\"}[1m])) by (le))", "legend": "GC P95"}], 12, y, w=12, unit="s", description="95th percentile of garbage collection duration. Long GC pauses can affect performance."))
    y += 8

    dashboard = {
        "__inputs": [
            {
                "name": "DS_PROMETHEUS",
                "label": "Prometheus",
                "description": "",
                "type": "datasource",
                "pluginId": "prometheus",
                "pluginName": "Prometheus",
            }
        ],
        "annotations": {"list": [{"builtIn": 1, "datasource": {"type": "grafana", "uid": "-- Grafana --"}, "enable": True, "hide": True, "iconColor": "rgba(0, 211, 255, 1)", "name": "Annotations & Alerts", "type": "dashboard"}]},
        "editable": True,
        "fiscalYearStartMonth": 0,
        "graphTooltip": 1,
        "id": None,
        "links": [],
        "liveNow": False,
        "panels": panels,
        "refresh": "15s",
        "schemaVersion": 37,
        "style": "dark",
        "tags": ["price-aggregator", "cache-health", "v3"],
        "templating": {
            "list": [
                {"current": {"selected": True, "text": "price-aggregator", "value": "price-aggregator"}, "datasource": PROM_DS, "definition": "label_values(up, job)", "hide": 2, "includeAll": False, "multi": False, "name": "job", "query": {"query": "label_values(up, job)", "refId": "StandardVariableQuery"}, "refresh": 1, "regex": "", "skipUrlSync": False, "sort": 0, "type": "query"},
                {"current": {"selected": True, "text": "All", "value": "$__all"}, "datasource": PROM_DS, "definition": "label_values(up{job=\"$job\"}, instance)", "hide": 0, "includeAll": True, "multi": True, "name": "instance", "query": {"query": "label_values(up{job=\"$job\"}, instance)", "refId": "StandardVariableQuery"}, "refresh": 1, "regex": "", "skipUrlSync": False, "sort": 0, "type": "query"},
                {"current": {"selected": True, "text": "All", "value": "$__all"}, "datasource": PROM_DS, "definition": "label_values(quotes_processed_total{job=\"$job\"}, source)", "hide": 0, "includeAll": True, "multi": True, "name": "source", "query": {"query": "label_values(quotes_processed_total{job=\"$job\"}, source)", "refId": "StandardVariableQuery"}, "refresh": 1, "regex": "", "skipUrlSync": False, "sort": 0, "type": "query"},
                {"current": {"selected": True, "text": "All", "value": "$__all"}, "datasource": PROM_DS, "definition": "label_values(price_update_frequency_seconds_bucket{job=\"$job\"}, pair)", "hide": 0, "includeAll": True, "multi": True, "name": "pair", "query": {"query": "label_values(price_update_frequency_seconds_bucket{job=\"$job\"}, pair)", "refId": "StandardVariableQuery"}, "refresh": 1, "regex": "", "skipUrlSync": False, "sort": 0, "type": "query"},
            ]
        },
        "time": {"from": "now-30m", "to": "now"},
        "timepicker": {"refresh_intervals": ["10s", "30s", "1m", "5m"]},
        "timezone": "browser",
        "title": f"Price Aggregator Observability ({datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')})",
        "uid": f"price-agg-{str(uuid.uuid4())[:8]}",
        "version": 1,
        "weekStart": "",
    }

    return dashboard

def main() -> None:
    dashboard = dashboard_definition()
    output_path = "./price-aggregator-dashboard.json"
    with open(output_path, "w", encoding="utf-8") as fp:
        json.dump(dashboard, fp, indent=2)
        fp.write("\n")

if __name__ == "__main__":
    main()
