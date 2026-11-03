-- Run the poll-divvy worker on Supabase Cron.
-- Every call carries x-worker-secret, read from Vault at call time (never stored in the job text).

-- Every 10 s: read station_status and save what changed.
select cron.schedule(
  'dockcheck-poll-divvy',
  '10 seconds',
  $$
    select net.http_post(
      url := 'https://jdbvghqeemcduoeubtmp.supabase.co/functions/v1/poll-divvy',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'dockcheck_worker_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 20000
    );
  $$
);

-- Hourly at :41: also refresh station_information (names, places, capacity change on the scale of days).
select cron.schedule(
  'dockcheck-refresh-info',
  '41 * * * *',
  $$
    select net.http_post(
      url := 'https://jdbvghqeemcduoeubtmp.supabase.co/functions/v1/poll-divvy',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'dockcheck_worker_secret')
      ),
      body := '{"refresh_info": true}'::jsonb,
      timeout_milliseconds := 20000
    );
  $$
);

-- Same name = replaces the cleanup job from dockcheck_init, now also trimming pg_cron's own
-- history for Dockcheck's jobs (8,640+ rows a day from the 10 s job).
select cron.schedule(
  'dockcheck-cleanup',
  '17 * * * *',
  $$
    delete from public.station_changes where changed_at < now() - interval '24 hours';
    delete from public.worker_runs     where ran_at     < now() - interval '7 days';
    delete from cron.job_run_details
     where end_time < now() - interval '1 day'
       and jobid in (select jobid from cron.job where jobname like 'dockcheck-%');
  $$
);
