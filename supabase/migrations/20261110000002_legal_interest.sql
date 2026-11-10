-- Late interest: by default the legal commercial rate (DL 62/2013, ECB rate + 8 pp, published each
-- semester by an Aviso in Diário da República) is used and kept up to date by the app. A different
-- rate is used only when the owner says it was agreed in the contract or invoice terms.
alter table public.organizations
  add column late_interest_custom boolean not null default false;
