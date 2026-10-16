# Legal notes for sharing ShaperBuild

A plain-language checklist of what the law asks of this project when it is
shared or sold, written for a developer in Norway (EEA). It is a careful
summary, not legal advice; for a business launch, have a lawyer check it.

## Done in the project

- **ShaperBuild's own licence: GNU GPL, version 3 or later.** ShaperBuild
  is free and open-source software ([LICENSE](LICENSE)). Anyone may use,
  copy, change, share and even sell it, but whoever shares a copy or a
  changed version must share it under the same licence and give people
  its source code. There is no warranty. The About box says this, as the
  GPL asks for programs with a user interface.
  - Version 3 is needed because Manifold uses Apache-2.0, which fits with
    GPL version 3 but not version 2. The LGPL geometry engine and the MIT,
    ISC, BSD-style and OFL parts all fit with GPL-3.0.
  - Publishing installers on GitHub next to the source code (the same
    tagged version) is enough to meet the "give people the source" rule.
  - Pull requests from others are shared under the same licence. If you
    may want to change the licence later, ask contributors to agree to
    that, or keep track of who wrote what.
- **Open-source licences of the libraries.** Every library the app ships is listed in
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and inside the app
  (*Help → Open-source licences*), and the licence texts are included in
  the installers. All are permissive (MIT, Apache-2.0, ISC, BSD-style,
  OFL for the font) except the geometry engine.
- **Geometry engine (LGPL-2.1).** Open CASCADE is used as an unchanged,
  separate library that is loaded at run time and kept outside the app's
  archive, so people can replace it with their own build. Where to get its
  source code is written in the notices. This is what the LGPL asks for;
  the rest of ShaperBuild does not have to be open source because of it.
- **No other company's names or material.** ShaperBuild does not use
  another CAD program's name, logo, artwork, icons, code or manual text.
  Names of file formats and programs it works with (STEP, PrusaSlicer…)
  are only used to say so. Making a program that works in a similar way is
  allowed: functions and workflows are not protected by copyright in the
  EU (EU Court of Justice, *SAS Institute*, C-406/10); code, artwork and
  texts are, and all of ShaperBuild's are its own.
- **Privacy (GDPR).** ShaperBuild has no accounts, no tracking and no
  analytics. Designs, settings, versions and recovery copies stay on the
  computer. The only network use is the update check, which asks GitHub
  for the newest release (GitHub sees the computer's IP address); it can
  be turned off in Settings. This is stated in the app (*Help → Privacy*)
  and in [PRIVACY.md](PRIVACY.md).

## Still to check before sharing widely

1. **Check the name "ShaperBuild".** "Shaper" is used by Shaper Tools, Inc.
   (Shaper Origin, Shaper Studio), which also makes design software, and
   other registered names for 3D software are close to it. Before
   publishing widely, search the registers for similar names in classes 9
   and 42:
   [Patentstyret](https://search.patentstyret.no/),
   [EUIPO eSearch](https://euipo.europa.eu/eSearch/),
   [WIPO Brand Database](https://branddb.wipo.int/) (and the
   [USPTO](https://tmsearch.uspto.gov/) for the USA). If a similar name
   is registered for software, pick another name.
2. **Who publishes it.** The copyright line says "BerdalYe". If a company
   will publish it, change the copyright and the publisher name in
   `package.json` (`build.copyright`) to the company.

## If you sell it

- **Business registration and tax.** Selling software is business
  activity: register in Brønnøysundregistrene (for example as an
  enkeltpersonforetak), and register for MVA (VAT) when sales pass
  NOK 50 000 in 12 months. For buyers in other EU countries, VAT rules for
  digital services apply (the VOEC scheme covers Norwegian sales of digital
  services *to* Norway from abroad; selling *from* Norway to EU consumers
  usually means the EU's non-Union OSS scheme). An app store or a reseller that is
  the "merchant of record" (for example Paddle or Lemon Squeezy) handles
  this for you.
- **Consumer rights.** Norwegian and EU consumers have a 14-day right to
  cancel online purchases (angrerettloven). For downloads it ends when the
  download starts, but only if the buyer agreed to that and was told so
  before paying. Software sold to consumers must work as described
  (forbrukerkjøpsloven / digitalytelsesloven); write clear terms and say
  what is included.
- **Terms of use / EULA.** A short licence agreement shown at purchase or
  install is good practice (what the buyer may do, no warranty beyond the
  law, limitation of liability within what consumer law allows).
- **Cyber Resilience Act (EU 2024/2847).** Software sold or otherwise
  supplied commercially in the EU must meet security requirements from
  11 December 2027 (secure by default, security updates, a way to report
  vulnerabilities, CE marking for most products), and actively exploited
  vulnerabilities must be reported since 11 September 2026. It is expected
  to apply in Norway through the EEA agreement, and it matters as soon as
  you sell to EU customers. Free, non-commercial open-source releases are
  outside it. If you plan to sell,
  keep the auto-updater, publish a `SECURITY.md` with a contact address,
  and keep a list of the libraries you ship (the notices file is a start).
- **Code signing.** Not a legal requirement, but Windows and macOS warn
  about unsigned apps; signing certificates cost money and need a
  registered identity.

## Not needed

- Export control: ShaperBuild uses only standard encryption (HTTPS in the
  update check), which mass-market software may be shared with freely.
- The EU Accessibility Act does not cover desktop CAD programs.
- The EU AI Act does not apply: ShaperBuild has no AI features.
