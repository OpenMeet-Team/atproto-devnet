# Written by bin/snowglobe.mjs render from snowglobe.default.yml; render again instead of editing.

set $pds_alpha http://pds-alpha:3000;
set $pds_regular http://pds-regular:3000;
set $pds_prod http://pds-prod:3000;

location = /health/pds { proxy_pass $pds_alpha/xrpc/_health; }
location = /people/listRepos { proxy_pass $pds_alpha/xrpc/com.atproto.sync.listRepos$is_args$args; }
location = /people/describeRepo { proxy_pass $pds_alpha/xrpc/com.atproto.repo.describeRepo$is_args$args; }
location = /health/alpha { proxy_pass $pds_alpha/xrpc/_health; }
location = /people/alpha/listRepos { proxy_pass $pds_alpha/xrpc/com.atproto.sync.listRepos$is_args$args; }
location = /people/alpha/describeRepo { proxy_pass $pds_alpha/xrpc/com.atproto.repo.describeRepo$is_args$args; }
location = /health/regular { proxy_pass $pds_regular/xrpc/_health; }
location = /people/regular/listRepos { proxy_pass $pds_regular/xrpc/com.atproto.sync.listRepos$is_args$args; }
location = /people/regular/describeRepo { proxy_pass $pds_regular/xrpc/com.atproto.repo.describeRepo$is_args$args; }
location = /health/prod { proxy_pass $pds_prod/xrpc/_health; }
location = /people/prod/listRepos { proxy_pass $pds_prod/xrpc/com.atproto.sync.listRepos$is_args$args; }
location = /people/prod/describeRepo { proxy_pass $pds_prod/xrpc/com.atproto.repo.describeRepo$is_args$args; }
