<?php
// Proxy for milon.madrasafree.com spoken-Arabic dictionary.
// Fetches the search page server-side and parses the result cards into JSON
// for the Plonter vocab "מדוברת" tab (Dictionary._searchSpoken).
//
// Rewritten 2026-06-18 (@8m / Plonter_8_milon_bot): the legacy proxy lived on
// www.yisumatica.org.il/plonter6 (now decommissioned -> 404) AND parsed the OLD
// madrasafree HTML (div.result/.heb/.arb/.eng). The site was redesigned to
// BEM-style "result-card__*" markup, so this version parses the new structure
// and is hosted same-origin at iseemath.co/plonter/api/.
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

$q = isset($_GET['q']) ? trim($_GET['q']) : '';
if ($q === '') { echo json_encode(['entries' => [], 'error' => 'missing q'], JSON_UNESCAPED_UNICODE); exit; }

$url = 'https://milon.madrasafree.com/?searchString=' . urlencode($q);
$ch = curl_init($url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 12);
curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (compatible; PlonterMilon/1.0)');
$html = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
// curl_close() omitted: no-op and deprecated since PHP 8.0; emitting its
// warning would corrupt the JSON response on stricter server configs.

if (!$html || $httpCode >= 400) {
    echo json_encode(['entries' => [], 'error' => 'fetch failed', 'http' => $httpCode], JSON_UNESCAPED_UNICODE);
    exit;
}

$dom = new DOMDocument();
@$dom->loadHTML('<?xml encoding="utf-8"?>' . $html);
$xpath = new DOMXPath($dom);

// Match any <article> whose class list contains the token "result-card"
// (variants: result-card--exact / --other). Padding the class with spaces
// makes the token test exact and avoids matching "sentence-box".
$cardQuery = '//article[contains(concat(" ", normalize-space(@class), " "), " result-card ")]';

// Helper: first matching node's trimmed text within a context, by class token.
$firstText = function($contextNode, $classToken) use ($xpath) {
    $nodes = $xpath->query('.//*[contains(concat(" ", normalize-space(@class), " "), " ' . $classToken . ' ")]', $contextNode);
    if ($nodes->length > 0) return trim($nodes->item(0)->textContent);
    return null;
};

$entries = [];
$cards = $xpath->query($cardQuery);
foreach ($cards as $card) {
    $entry = [];

    // Hebrew headword
    $heb = $firstText($card, 'result-card__heading');
    if ($heb !== null && $heb !== '') $entry['heb'] = $heb;

    // Arabic (primary word) — exclude the number-form arabic which has its own class token
    $arNodes = $xpath->query('.//*[contains(concat(" ", normalize-space(@class), " "), " result-card__arabic ")]', $card);
    if ($arNodes->length > 0) $entry['arabic'] = trim($arNodes->item(0)->textContent);

    // Transliteration (vocalized Hebrew)
    $translit = $firstText($card, 'result-card__transliteration');
    if ($translit !== null && $translit !== '') $entry['translit'] = $translit;

    // Grammar tags (שם עצם / זכר / יחיד ...) — array of inline items
    $grammar = [];
    $gNodes = $xpath->query('.//*[contains(concat(" ", normalize-space(@class), " "), " grammar-inline__item ")]', $card);
    foreach ($gNodes as $g) {
        $t = trim($g->textContent);
        if ($t !== '') $grammar[] = $t;
    }
    if (count($grammar) > 0) $entry['grammar'] = $grammar;

    // Definition
    $def = $firstText($card, 'result-card__definition');
    if ($def !== null && $def !== '') $entry['definition'] = $def;

    // Note (the note-text, not the "הערה" label)
    $note = $firstText($card, 'result-card__note-text');
    if ($note !== null && $note !== '') $entry['note'] = $note;

    // Number forms (singular/plural) -> [{label, arabic, translit}]
    $forms = [];
    $formNodes = $xpath->query('.//*[contains(concat(" ", normalize-space(@class), " "), " result-card__number-form ")]', $card);
    foreach ($formNodes as $fn) {
        $f = [];
        $labelNodes  = $xpath->query('.//*[contains(concat(" ", normalize-space(@class), " "), " result-card__number-form-label ")]', $fn);
        $arabicNodes = $xpath->query('.//*[contains(concat(" ", normalize-space(@class), " "), " result-card__number-form-arabic ")]', $fn);
        $tlNodes     = $xpath->query('.//*[contains(concat(" ", normalize-space(@class), " "), " result-card__number-form-transliteration ")]', $fn);
        if ($labelNodes->length > 0)  $f['label']   = trim($labelNodes->item(0)->textContent);
        if ($arabicNodes->length > 0) $f['arabic']  = trim($arabicNodes->item(0)->textContent);
        if ($tlNodes->length > 0)     $f['translit'] = trim($tlNodes->item(0)->textContent);
        if (!empty($f)) $forms[] = $f;
    }
    if (count($forms) > 0) $entry['forms'] = $forms;

    // Full-word link
    $linkNodes = $xpath->query('.//a[contains(concat(" ", normalize-space(@class), " "), " result-card__footer ")]/@href', $card);
    if ($linkNodes->length > 0) {
        $href = $linkNodes->item(0)->value;
        if ($href !== '') {
            if (strpos($href, 'http') !== 0) {
                $href = 'https://milon.madrasafree.com' . (strpos($href, '/') === 0 ? '' : '/') . $href;
            }
            $entry['link'] = $href;
        }
    }

    // Only keep cards that yielded at least a headword or arabic
    if (isset($entry['heb']) || isset($entry['arabic'])) $entries[] = $entry;
}

echo json_encode(['entries' => $entries, 'query' => $q], JSON_UNESCAPED_UNICODE);
