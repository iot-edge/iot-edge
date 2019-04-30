CDN
===

These files are served by NGINX under the /cdn path.

This mechanism offers a common URL pattern, allwoing browsers
to cache assets across different edge servers within a common
top level domain.

Versioning of all files within the CDN allows NGINX to set long
term cache expiration headers so browsers can keep these files
for long periods without reloading.

edge
----

These files are added to the grafana index.html page, offering
enhancements for grafana pages contained within controlling apps.

grafana
-------

These are static assets from specific Grafana distributions.

Any one edge server needs only the Grafana version that it
serves, while a shared CDN would serve all versions to support
many edge servers.
