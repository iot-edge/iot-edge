CDN
===

These files are served by NGINX under the /cdn path.

This mechanism offers a common URL pattern, allwoing browsers 
to cache assets across different edge servers within a common 
top level domain.

This improves browser performance when traversing across
multiple edge servers.

Versioning of all files within the CDN allows NGINX to set long
term cache expiration headers so browsers can keep these files 
for long periods without reloading. 

edge
----

These files are added to the grafana index.html page, offering 
visual and logical enhancements for grafana pages contained 
within controlling applications.

grafana
-------

These are static assets for specific Grafana distributions.

Any one edge server needs only the Grafana version that it
serves, while a shared CDN would want to maintain all versions
to support many edge servers.
