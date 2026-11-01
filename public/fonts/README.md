# OG image fonts

`Inter-Regular.ttf` and `Inter-Bold.ttf` are static instances of
[Inter](https://github.com/rsms/inter) (v4.x, from the official Google Fonts
release `ofl/inter/Inter[opsz,wght].ttf`), instantiated at `wght=400`/`wght=700`
and subset to the Latin script ranges used by the Open Graph cards. They are
consumed only by `functions/og/[[path]].ts` (satori needs raw TTF data).

Inter is licensed under the SIL Open Font License, Version 1.1 — see
`Inter-OFL.txt`. The subset files keep the original font name/licence metadata;
they are not sold and are only served as the site's OG card font.

Regenerate with fonttools (only needed if the card copy changes):

```sh
pip install fonttools
fonttools varLib.instancer Inter[opsz,wght].ttf wght=400 -o Inter-400-full.ttf
fonttools subset Inter-400-full.ttf \
  --unicodes='U+0020-024F,U+2000-206F,U+20A0-20BF,U+2100-214F,U+2190-2193,U+25A0-25FF,U+FEFF' \
  --layout-features='*' --no-hinting --output-file=Inter-Regular.ttf
```
