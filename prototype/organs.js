(function () {
  'use strict';

  const viewBox = '0 0 360 690';

  const definitions = `
    <defs>
      <radialGradient id="wa-skin" cx=".49" cy=".36" r=".66">
        <stop offset="0" stop-color="var(--anatomy-bg, #f5e6dd)"/>
        <stop offset="1" stop-color="var(--anatomy-fill, #ebcfc2)"/>
      </radialGradient>
      <radialGradient id="wa-brain" cx=".35" cy=".25" r=".77">
        <stop offset="0" stop-color="#d2a5a0"/>
        <stop offset="1" stop-color="#ac7885"/>
      </radialGradient>
      <radialGradient id="wa-lungs" cx=".43" cy=".30" r=".74">
        <stop offset="0" stop-color="#e0b3a9"/>
        <stop offset="1" stop-color="#b98180"/>
      </radialGradient>
      <linearGradient id="wa-heart" x2=".95" y2="1">
        <stop offset="0" stop-color="#c98183"/>
        <stop offset=".45" stop-color="#a65362"/>
        <stop offset="1" stop-color="#823c51"/>
      </linearGradient>
      <linearGradient id="wa-liver" x2=".84" y2="1">
        <stop offset="0" stop-color="#bd866d"/>
        <stop offset=".55" stop-color="#a16955"/>
        <stop offset="1" stop-color="#87514c"/>
      </linearGradient>
      <linearGradient id="wa-stomach" x2=".94" y2=".9">
        <stop offset="0" stop-color="#e7b99a"/>
        <stop offset="1" stop-color="#bf8380"/>
      </linearGradient>
      <linearGradient id="wa-spleen" x2=".93" y2="1">
        <stop offset="0" stop-color="#ba95a1"/>
        <stop offset="1" stop-color="#906b84"/>
      </linearGradient>
      <linearGradient id="wa-pancreas" x2=".42" y2="1">
        <stop offset="0" stop-color="#ddbc8f"/>
        <stop offset="1" stop-color="#b18065"/>
      </linearGradient>
      <radialGradient id="wa-kidney" cx=".4" cy=".35" r=".67">
        <stop offset="0" stop-color="#d69483"/>
        <stop offset="1" stop-color="#a06568"/>
      </radialGradient>
      <linearGradient id="wa-bowel" x2=".84" y2="1">
        <stop offset="0" stop-color="#d9ad8f"/>
        <stop offset="1" stop-color="#be887e"/>
      </linearGradient>
      <linearGradient id="wa-pelvic" x2=".75" y2="1">
        <stop offset="0" stop-color="#d8a198"/>
        <stop offset="1" stop-color="#ad7481"/>
      </linearGradient>
      <clipPath id="wa-body-clip"><use href="#wa-body-outline"/></clipPath>
    </defs>
    <style>
      .wa-plate { stroke-linecap: round; stroke-linejoin: round; }
      .wa-plate .wa-tissue, .wa-plate .wa-bowel-edge {
        stroke: var(--wa-edge, #815656);
        stroke-width: 1.35;
      }
      .wa-plate .wa-context { pointer-events: none; }
      .wa-plate .wa-bones { fill: none; stroke: var(--anatomy-axis, #be9e92); }
      .wa-plate .wa-detail { fill: none; pointer-events: none; }
      .wa-plate .wa-bowel-edge { stroke-width: 19; }
      .wa-plate .org { cursor: pointer; outline: none; }
      .wa-plate .org:hover .wa-tissue { stroke-width: 2.35; }
      .wa-plate .org:is(.sel, :focus-visible) :is(.wa-tissue, .wa-bowel-edge) { stroke: var(--accent, #8c3148); }
      .wa-plate .org:is(.sel, :focus-visible) .wa-tissue { stroke-width: 2.8; }
      .wa-plate .org:is(.sel, :focus-visible) .wa-bowel-edge { stroke-width: 22; }
      .wa-plate .org:focus-visible :is(.wa-tissue, .wa-bowel-edge) {
        filter: drop-shadow(0 0 2px var(--accent, #8c3148));
      }
      .wa-callouts {
        pointer-events: none;
        color: var(--ink-3, #6f6061);
        font: 550 11px system-ui, "Microsoft YaHei", sans-serif;
      }
      .wa-callouts path { fill: none; stroke: currentColor; stroke-width: .75; opacity: .54; }
      .wa-callouts text { fill: currentColor; }
      @media (max-width: 680px), (orientation: landscape) and (max-height: 560px) {
        .wa-callouts { display: none; }
      }
    </style>`;

  const frame = `
    <g class="wa-context">
      <path id="wa-body-outline" fill="url(#wa-skin)" stroke="var(--anatomy-line, #d8baad)" stroke-width="1.6" d="
        M180 15 C146 14 123 35 121 73 L120 100
        C109 94 110 112 113 125 C115 135 121 139 126 137
        C131 153 143 166 153 173 L153 190
        C150 199 137 202 117 206 C89 211 70 219 57 237
        C45 256 43 284 39 316 L26 390 C22 411 16 442 17 464
        C23 470 38 473 48 469 C57 451 62 428 69 409
        C81 378 91 350 99 316 C103 342 102 371 97 398
        C92 424 94 447 100 478 C106 507 108 529 102 553
        C94 584 87 620 93 666 Q180 694 267 666
        C273 620 266 584 258 553 C252 529 254 507 260 478
        C266 447 268 424 263 398 C258 371 257 342 261 316
        C269 350 279 378 291 409 C298 428 303 451 312 469
        C322 473 337 470 343 464 C344 442 338 411 334 390
        L321 316 C317 284 315 256 303 237 C290 219 271 211 243 206
        C223 202 210 199 207 190 L207 173 C217 166 229 153 234 137
        C239 139 245 135 247 125 C250 112 251 94 240 100
        L239 73 C237 35 214 14 180 15Z"/>
      <g class="wa-bones">
        <path stroke-width="1.4" opacity=".42" d="
          M128 89 Q126 42 153 30 Q179 17 206 28 Q233 40 233 89
          M125 105 Q115 104 118 120 M235 105 Q245 104 242 120
          M142 116 Q152 111 161 116 M218 116 Q208 111 199 116
          M178 121 Q174 132 174 136 Q180 140 186 136
          M166 151 Q174 152 180 150 Q186 152 194 151 M155 173 Q180 190 205 173"/>
        <path stroke-width="3" opacity=".42" d="
          M175 221 C159 215 142 213 125 216 Q101 221 86 231
          M185 221 C201 215 218 213 235 216 Q259 221 274 231
          M74 246 Q62 286 58 317 L35 450
          M286 246 Q298 286 302 317 L325 450
          M111 577 Q103 576 100 588 C107 621 128 641 149 646 Q165 650 174 654
          M249 577 Q257 576 260 588 C253 621 232 641 211 646 Q195 650 186 654"/>
        <path stroke-width="15" opacity=".15" d="M180 191 C182 265 174 337 178 401 C185 465 177 519 181 583 Q183 616 178 643"/>
        <path stroke-width="1.4" opacity=".39" d="
          M174 201h12m-12 9h12m-12 9h12m-12 9h12m-12 9h12m-13 9h12m-12 9h12
          M173 396h12m-12 12h13m-12 12h13m-12 12h13m-13 12h13m-14 12h13
          M174 522h13m-13 12h13m-13 12h13m-13 12h13m-12 12h13m-12 12h13m-12 12h12
          M169 245 Q135 225 104 246 M191 245 Q225 225 256 246
          M169 262 Q132 240 101 265 M191 262 Q228 240 259 265
          M169 280 Q131 256 99 284 M191 280 Q229 256 261 284
          M168 299 Q131 275 99 302 M192 299 Q229 275 261 302
          M166 320 Q128 295 101 322 M194 320 Q232 295 259 322
          M164 343 Q126 315 104 345 M196 343 Q234 315 256 345
          M161 366 Q125 339 106 363 M199 366 Q235 339 254 363
          M159 386 Q126 363 109 380 M201 386 Q234 363 251 380
          M105 567 Q126 551 147 580 L163 610 M255 567 Q234 551 213 580 L197 610"/>
      </g>
      <g fill="none">
        <path stroke="#a07b70" opacity=".67" stroke-width="9" d="M179 182 L179 263 Q177 275 151 292 M179 262 Q188 276 212 293"/>
        <path stroke="#e2bea4" opacity=".8" stroke-width="5" d="M179 182 L179 263 Q177 275 151 292 M179 262 Q188 276 212 293"/>
        <path stroke="#a07b70" opacity=".65" stroke-width="1.1" d="M175 188h8m-8 7h8m-8 7h8m-8 7h8m-8 7h8m-8 7h8m-8 7h8m-8 7h8m-8 7h8m-8 7h8m-8 7h8"/>
        <path stroke="#ad6571" opacity=".49" stroke-width="5.5" d="M191 330 C183 389 180 467 183 546 M183 480 Q156 473 133 483 M184 484 Q210 478 227 484 M183 546 Q164 569 148 602 M183 546 Q205 572 215 602"/>
        <path stroke="#8b7d9a" opacity=".47" stroke-width="4.1" d="M175 371 Q172 436 174 539 Q151 565 142 588 M174 539 Q191 554 207 587 M173 483 Q146 479 132 488 M177 488 Q203 482 229 488"/>
        <path stroke="#a17365" opacity=".28" stroke-width="2.6" d="M100 387 C135 364 157 385 180 392 C203 383 227 370 260 387"/>
      </g>
    </g>`;

  function organ(id, name, art) {
    return `<g class="org" data-o="${id}" role="button" tabindex="0" aria-label="${name}" aria-pressed="false">${art}</g>`;
  }

  const brain = organ('brain', '脑', `
    <path class="wa-tissue" fill="url(#wa-brain)" d="
      M180 47 C176 41 165 41 159 45 C151 43 143 48 141 54
      C133 55 128 63 130 69 C123 73 122 83 126 89
      C121 98 125 106 131 109 C129 117 139 123 146 120
      C152 126 164 123 169 119 Q175 122 180 116
      Q185 122 191 119 C197 123 207 126 215 120 C222 123 231 117 229 109
      C236 105 239 97 234 89 C238 83 236 73 230 69 C232 63 227 55 219 54
      C216 48 208 43 201 45 C195 41 184 41 180 47Z"/>
    <path class="wa-detail" stroke="#70495c" stroke-width="1.55" opacity=".65" d="
      M180 48 Q177 58 181 68 Q176 80 180 89 Q176 100 180 115
      M144 54 Q154 56 149 64 Q143 68 147 76 M132 70 Q142 68 141 77 Q138 80 133 82
      M158 47 Q166 51 163 57 Q158 62 164 67 Q170 68 171 74
      M150 77 Q158 74 162 80 Q166 88 175 86 M128 90 Q135 91 139 87 Q144 80 150 87
      M140 97 Q148 93 152 99 Q155 106 150 110 M153 90 Q158 88 166 93 Q170 97 165 103
      M131 107 Q136 102 144 107 M160 118 Q156 111 162 108 Q169 108 174 103
      M216 54 Q210 52 208 60 Q208 66 214 69 M228 69 Q220 66 217 74 Q217 82 224 84
      M197 47 Q192 52 196 59 Q197 62 193 66 Q186 68 188 75
      M208 74 Q201 74 200 81 Q198 86 191 85 M232 93 Q223 95 219 88 Q213 84 207 89
      M203 91 Q198 91 195 97 Q194 102 199 104 M216 96 Q209 94 206 101 Q205 105 210 110
      M226 109 Q223 105 216 109 M200 118 Q204 113 200 110 Q192 109 188 102"/>
    <path class="wa-detail" stroke="#f4cdbd" stroke-width="2.4" opacity=".6" d="
      M137 62 Q144 53 157 52 Q168 46 175 49 M185 50 Q195 46 202 51 Q218 52 224 62"/>
  `);

  const lungs = organ('lung', '肺', `
    <path class="wa-tissue" fill="url(#wa-lungs)" d="
      M151 224 C140 224 133 240 129 248 C121 258 110 273 105 293
      C102 309 100 340 102 357 C102 369 104 376 115 376
      C131 377 151 364 162 351 C174 337 167 320 166 302
      C165 287 175 278 173 262 C173 246 161 224 151 224Z
      M207 224 C220 225 227 240 231 251 C239 263 249 279 254 297
      C257 319 260 344 258 359 C257 372 254 377 245 376
      C231 375 218 368 210 355 C204 345 208 334 205 324
      C203 315 194 310 191 302 C187 292 185 278 187 264
      C187 247 196 225 207 224Z"/>
    <path class="wa-detail" stroke="#875961" stroke-width="1.6" opacity=".57" d="
      M106 317 Q124 315 162 308 M106 338 Q123 333 159 310 M255 337 Q245 331 224 312 Q214 303 196 297"/>
    <path class="wa-detail" stroke="#e8c5b3" stroke-width="2.1" opacity=".83" d="
      M165 271 Q155 277 145 288 L129 311 M145 288 Q131 284 122 290
      M142 295 Q143 312 132 338 M146 302 Q151 309 152 317 M129 311 Q120 314 114 324
      M194 271 Q208 278 215 292 L230 314 M215 292 Q230 285 243 296
      M219 299 Q217 316 222 329 M231 315 Q237 331 244 346 M230 315 Q243 317 249 327"/>
    <path class="wa-detail" stroke="#f2d2c0" stroke-width="2.25" opacity=".5" d="
      M151 232 C140 237 140 250 131 258 Q107 291 105 321
      M210 231 Q220 239 224 253 C240 273 250 298 254 322"/>
  `);

  const heart = organ('heart', '心脏', `
    <path class="wa-tissue" fill="#ba7a82" d="
      M175 308 C168 290 166 273 174 263 C179 257 189 257 196 262
      L200 254 Q205 253 209 257 L206 267 Q211 269 214 275 L225 272 L229 282
      L217 288 Q211 282 206 284 Q193 287 194 311Z"/>
    <path class="wa-detail" stroke="#ecc2ab" stroke-width="2.8" opacity=".67" d="
      M180 295 C173 284 173 268 184 265 Q196 264 203 270"/>
    <path class="wa-tissue" fill="url(#wa-heart)" d="
      M184 297 C172 289 158 298 157 315 C156 326 162 339 170 346
      C175 364 188 383 209 391 C220 396 228 390 230 375
      C232 358 225 344 221 332 C234 330 239 316 232 305
      C225 294 212 296 203 305 C200 297 192 292 184 297Z"/>
    <path class="wa-detail" stroke="#783e54" stroke-width="2" opacity=".73" d="
      M174 308 Q190 313 197 321 C208 337 205 363 215 384 M197 321 Q207 315 221 315"/>
    <path class="wa-detail" stroke="#f1bea4" stroke-width="1.85" opacity=".77" d="
      M162 320 Q169 327 180 328 Q192 329 198 339 C204 351 198 364 210 379
      M193 334 Q193 345 186 351 M200 350 Q211 347 219 353"/>
    <path class="wa-detail" stroke="#e6a89f" stroke-width="2.4" opacity=".62" d="
      M165 309 Q170 299 182 301 M211 307 Q222 300 227 308"/>
  `);

  const liver = organ('liver', '肝脏', `
    <path class="wa-tissue" fill="url(#wa-liver)" d="
      M127 378 C146 372 162 382 179 388 C193 394 207 391 215 398
      C225 409 211 418 200 421 C188 425 182 437 169 444
      C155 455 136 460 119 454 C108 451 102 447 103 437
      C102 427 105 419 102 410 C99 399 108 384 127 378Z"/>
    <path class="wa-detail" stroke="#edba98" stroke-width="2.6" opacity=".59" d="
      M108 402 C116 385 135 382 152 386 C172 389 181 401 199 399 M170 391 Q163 416 174 441"/>
    <path class="wa-detail" stroke="#72484b" stroke-width="1.7" opacity=".52" d="
      M108 441 C128 447 146 443 160 439 Q169 435 172 426"/>
  `);

  const spleen = organ('spleen', '脾脏', `
    <path class="wa-tissue" fill="url(#wa-spleen)" d="
      M248 386 C255 383 261 390 262 399 C267 419 261 437 253 444
      C246 450 240 444 242 438 C243 431 239 428 238 421
      C237 410 241 393 248 386Z"/>
    <path class="wa-detail" stroke="#e5bcc0" stroke-width="2" opacity=".6" d="M253 390 Q261 396 260 410 Q260 428 253 435"/>
  `);

  const stomach = organ('stomach', '胃', `
    <path class="wa-tissue" fill="url(#wa-stomach)" d="
      M199 390 L210 389 C210 399 209 407 215 409
      C222 409 225 401 232 401 C243 400 253 414 252 427
      C251 446 243 459 227 468 C216 475 201 473 192 467
      C185 462 181 463 175 466 L171 457 C180 449 188 449 192 440
      C196 430 191 420 195 412 C199 408 198 400 199 390Z"/>
    <path class="wa-detail" stroke="#f4d3af" stroke-width="2.5" opacity=".65" d="
      M211 416 Q219 415 224 411 Q235 404 241 415 C250 427 244 443 236 450"/>
    <path class="wa-detail" stroke="#a26965" stroke-width="1.45" opacity=".6" d="
      M198 427 Q206 431 205 440 Q200 453 205 461 M205 427 Q214 432 211 442 Q208 452 213 460
      M214 424 Q223 432 218 444 Q216 451 220 457"/>
  `);

  const kidneys = organ('kidney', '肾脏', `
    <path class="wa-tissue" fill="url(#wa-kidney)" d="
      M119 444 C108 449 107 465 107 478 C106 497 109 514 118 519
      C126 523 138 514 140 504 C142 495 135 492 132 487
      C129 483 136 477 139 471 C143 460 132 439 116 444Z
      M240 434 C252 439 253 455 253 468 C254 487 251 505 242 511
      C234 515 222 506 220 496 C218 488 225 483 228 478
      C231 474 224 469 221 463 C217 451 228 429 243 434Z"/>
    <path class="wa-detail" stroke="#f1b8a2" stroke-width="2.2" opacity=".57" d="
      M119 451 C110 461 110 494 117 505 M240 441 C249 452 250 483 243 497"/>
    <path class="wa-detail" stroke="#77516b" stroke-width="1.5" opacity=".7" d="
      M126 462 Q130 469 124 479 Q119 490 126 502 M234 452 Q230 460 236 470 Q241 482 234 494"/>
  `);

  const pancreas = organ('pancreas', '胰腺', `
    <path class="wa-tissue" fill="url(#wa-pancreas)" d="
      M151 463 C157 461 160 464 166 462 C171 461 174 464 179 464
      C185 464 189 460 195 462 C202 463 205 459 211 460
      C218 460 221 455 228 457 C236 456 241 452 246 455
      C249 458 245 462 241 463 C235 465 231 469 222 469
      C213 470 208 474 199 474 C192 473 187 479 180 480
      C174 478 170 483 164 483 C159 480 152 486 146 482
      C140 477 144 466 151 463Z"/>
    <path class="wa-detail" stroke="#f1d3a5" stroke-width="2" opacity=".75" d="M151 470 Q164 467 180 470 Q198 465 214 466 Q229 462 241 459"/>
    <path class="wa-detail" stroke="#905a52" stroke-width="1.3" opacity=".56" d="M154 477 Q169 474 180 475 Q198 469 213 469 Q227 467 239 462"/>
  `);

  const colonCurve = `M121 571 C114 555 119 540 116 524 C114 507 121 497 134 497
    C155 497 168 504 184 504 C204 504 220 492 235 498 C246 501 247 512 243 529
    C239 550 245 571 233 587 C222 601 207 593 200 604 C195 611 197 617 197 624`;

  const bowel = organ('gut', '肠道与直肠', `
    <path class="wa-tissue" fill="url(#wa-bowel)" d="
      M134 515 C140 509 158 512 170 514 C192 511 219 507 226 521
      C235 535 227 548 228 560 C230 576 214 590 202 598
      C187 608 178 598 164 601 C148 604 137 594 132 583
      C124 567 133 556 129 544 Q125 526 134 515Z"/>
    <path class="wa-detail" stroke="#995f63" stroke-width="2.6" opacity=".7" d="
      M140 529 C159 518 188 522 192 531 C196 540 165 541 151 540 C134 540 134 550 152 552
      C172 553 200 548 207 553 C215 561 194 569 172 566 C149 564 141 568 145 578
      C150 588 168 579 180 580 C194 582 201 589 207 581 Q211 577 219 575
      M209 522 Q226 529 217 539 Q213 543 205 544 M187 551 Q190 559 181 566
      M174 582 Q176 589 171 596 M152 553 Q155 558 151 563"/>
    <path class="wa-detail" stroke="#edc0a7" stroke-width="2" opacity=".75" d="
      M142 531 Q165 525 185 530 M193 536 Q178 544 155 543
      M142 556 Q160 558 182 554 M155 572 Q179 576 197 568 M171 585 Q182 585 192 591"/>
    <path class="wa-bowel-edge" fill="none" d="${colonCurve}"/>
    <path class="wa-detail" stroke="#c69378" stroke-width="15.5" d="${colonCurve}"/>
    <path class="wa-tissue" fill="#c69378" d="
      M188.2 624 C188.2 633 190 635 189 642 C188 649 189 653 190 656
      Q191 659 190 664 C189 668 194 670 195 665 Q196 658 200 654
      C209 645 205.8 633 205.8 624"><title>直肠</title></path>
    <path class="wa-detail" stroke="#f0c4a1" stroke-width="2.1" opacity=".68" d="
      M118 567 Q113 546 116 520 Q118 497 135 499 C154 500 170 505 185 506 Q203 505 221 499
      Q245 494 244 514 M240 534 Q237 553 239 561 Q239 583 225 590
      M217 593 Q198 595 195 607 C191 619 197 630 194 641"/>
    <path class="wa-detail" stroke="#9d675e" stroke-width="1.3" opacity=".71" d="
      M113 551q5-5 10-1m-11-16q6-5 11-1m-12-16q5-4 10-2m0-21q0 5 4 9
      M142 490q-4 6-2 12m20-7q-4 4-4 10m20-6q-2 6-2 11m21-12q3 4 3 10
      M211 493q4 3 5 10m16-10q3 7-4 9m12 14q5-1 8 1m-11 19q5-2 11 1
      M236 556q5-3 11-1m-16 17q6-1 10 2m-21 9q4 3 5 8m-19-5q0 5 3 9"/>
  `);

  const uterus = organ('uterus', '子宫与卵巢', `
    <path class="wa-tissue" fill="none" d="M154 615 Q142 605 132 618 M180 615 Q197 603 212 616"/>
    <path class="wa-tissue" fill="url(#wa-pelvic)" d="
      M151 615 C151 607 160 607 167 608 C176 607 184 608 184 615
      C183 622 174 625 171 631 L170 635 Q167 637 164 635 L163 631
      C161 625 152 623 151 615Z"/>
    <ellipse class="wa-tissue" fill="url(#wa-pelvic)" cx="130" cy="620" rx="7" ry="4"/>
    <ellipse class="wa-tissue" fill="url(#wa-pelvic)" cx="215" cy="618" rx="7" ry="4"/>
  `);

  const bladder = organ('bladder', '膀胱', `
    <path class="wa-tissue" fill="#b2b6c1" d="
      M149 638 C150 631 158 629 168 629 C178 629 186 631 187 638
      C188 645 182 649 177 651 Q172 653 171 656 H165
      Q164 653 159 651 C154 649 148 645 149 638Z"/>
  `);

  const prostate = organ('prostate', '前列腺', `
    <path class="wa-tissue" fill="url(#wa-pelvic)" d="
      M155 659 C157 655 163 655 168 656 C173 655 179 655 181 659
      C182 664 175 669 168 670 C161 669 154 664 155 659Z"/>
  `);

  function callouts(female) {
    return `<g class="wa-callouts" aria-hidden="true">
      <path d="M30 78 H105 L128 70 M30 270 H73 L115 279 M29 395 H81 L108 405 M29 484 H80 L111 479 M29 564 H77 L113 557"/>
      <path d="M331 377 H269 L226 378 M332 418 H286 L266 413 M332 470 H282 L246 449"/>
      <path d="M30 640 H113 L149 639 M331 647 H242 L202 644"/>
      <path d="${female ? 'M30 605 H113 L152 616' : 'M42 666 H117 L155 661'}"/>
      <text x="6" y="82">脑</text>
      <text x="6" y="274">肺</text>
      <text x="5" y="399">肝脏</text>
      <text x="5" y="488">肾脏</text>
      <text x="5" y="568">肠道</text>
      <text x="5" y="644">膀胱</text>
      <text x="5" y="${female ? 609 : 670}">${female ? '子宫' : '前列腺'}</text>
      <g text-anchor="end">
        <text x="355" y="381">心脏</text>
        <text x="354" y="422">脾</text>
        <text x="354" y="474">胃</text>
        <text x="355" y="651">直肠</text>
      </g>
    </g>`;
  }

  function render(sex) {
    const female = sex === '女';
    return `${definitions}
      <g class="wa-plate">
        ${frame}
        <g clip-path="url(#wa-body-clip)">
          ${brain}${lungs}${heart}${kidneys}${pancreas}${liver}${spleen}${stomach}${bowel}
          ${female ? uterus : prostate}${bladder}
        </g>
        ${callouts(female)}
      </g>`;
  }

  window.WARD_ANATOMY = { viewBox, render };
})();
