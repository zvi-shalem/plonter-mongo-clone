<?php
// Dragon-only free HUJI/Milson dictionary proxy. Converts the public
// ArabDictionaryV2 JSON into the Milson-like entry shape Plonter already
// renders inline.

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

function respond($ok, $data = null, $err = null) {
    $out = ['success' => $ok, 'ok' => $ok];
    if ($data !== null) $out = array_merge($out, is_array($data) ? $data : ['data' => $data]);
    if ($err !== null) $out['error'] = $err;
    echo json_encode($out, JSON_UNESCAPED_UNICODE);
    exit;
}

function clean_text($value) {
    $s = trim((string)$value);
    return preg_replace('/\s+/u', ' ', $s);
}

function add_form(&$additional, $name, $value) {
    $name = clean_text($name);
    $value = clean_text($value);
    if ($name === '' || $value === '') return;
    if (!isset($additional[$name])) $additional[$name] = [];
    if (!in_array($value, $additional[$name], true)) $additional[$name][] = $value;
}

function additional_from($rawForms) {
    $additional = [];
    if (!is_array($rawForms)) return $additional;
    foreach ($rawForms as $form) {
        if (!is_array($form)) continue;
        $vals = $form['AdditionalValues'] ?? null;
        if (!is_array($vals)) continue;
        foreach ($vals as $v) {
            if (is_array($v)) add_form($additional, $form['AdditionalName'] ?? '', $v['AdditionalFormValue'] ?? '');
        }
    }
    return $additional;
}

function meanings_from($rawMeanings, $rawPreps = []) {
    $meanings = [];
    $prep = '';
    if (is_array($rawPreps) && isset($rawPreps[0]) && is_array($rawPreps[0])) {
        $prep = clean_text($rawPreps[0]['PrepositionValue'] ?? '');
    }
    if (!is_array($rawMeanings)) return $meanings;
    foreach ($rawMeanings as $m) {
        if (!is_array($m)) continue;
        $text = clean_text($m['MeaningValue'] ?? '');
        if ($text !== '') $meanings[] = ['text' => $text, 'prep' => $prep];
    }
    return $meanings;
}

function gender_label($g) {
    $g = (string)$g;
    if ($g === '1') return 'ז';
    if ($g === '2') return 'נ';
    return '';
}

// Son rows carry placeholder values ('' / '0') in Root/Gender/Verb while the
// real value lives on the parent headword — e.g. for كَتَبَ the future-vowel
// badge "ـُ" is on the parent and every son has Verb='0'. Treat ''/'0' as
// missing and inherit from the parent so the rendered entries keep the data.
function inherited($raw, $parent, $key) {
    $v = clean_text($raw[$key] ?? '');
    if (($v === '' || $v === '0') && is_array($parent)) $v = clean_text($parent[$key] ?? '');
    return $v === '0' ? '' : $v;
}

function entry_from($raw, $parent = null) {
    if (!is_array($raw)) return null;
    $value = clean_text($raw['Value'] ?? ($parent['Value'] ?? ''));
    if ($value === '') return null;
    $additional = additional_from($raw['AdditionalForms'] ?? []);
    if (is_array($parent)) {
        foreach (additional_from($parent['AdditionalForms'] ?? []) as $k => $vals) {
            foreach ($vals as $v) add_form($additional, $k, $v);
        }
    }
    return [
        'value' => $value,
        'root' => inherited($raw, $parent, 'Root'),
        'gender' => gender_label(inherited($raw, $parent, 'Gender')),
        'verb' => inherited($raw, $parent, 'Verb'),
        'additional' => (object)$additional,
        'meanings' => meanings_from($raw['Meanings'] ?? [], $raw['Prepositions'] ?? []),
        'source' => 'huji_free'
    ];
}

function flatten_entries($dataValues) {
    $entries = [];
    if (!is_array($dataValues)) return $entries;
    foreach ($dataValues as $raw) {
        if (!is_array($raw)) continue;
        $base = entry_from($raw);
        if ($base && count($base['meanings']) > 0) $entries[] = $base;
        $sons = $raw['Sons'] ?? [];
        if (is_array($sons)) {
            foreach ($sons as $son) {
                $entry = entry_from($son, $raw);
                if ($entry && count($entry['meanings']) > 0) $entries[] = $entry;
            }
        }
    }
    return $entries;
}

$q = trim((string)($_GET['q'] ?? ''));
$mode = (string)($_GET['mode'] ?? '1');
if ($q === '') respond(false, ['entries' => []], 'missing q');

$count = max(1, count(preg_split('/\s+/u', $q, -1, PREG_SPLIT_NO_EMPTY)));
$base = 'https://arabdictionary.huji.ac.il/ArabDictionaryV2/api/Search/';
$url = ($mode === '0' || strtoupper($mode) === 'R')
    ? $base . '0/' . rawurlencode($q) . '/R'
    : $base . rawurlencode($q) . '/' . $count;

$ctx = stream_context_create(['http' => [
    'method' => 'GET',
    'timeout' => 12,
    'header' => "User-Agent: Plonter-HUJI-Free-Dictionary/1.0\r\nAccept: application/json\r\n"
]]);
$raw = @file_get_contents($url, false, $ctx);
if ($raw === false) respond(false, ['entries' => []], 'huji fetch failed');

$json = json_decode($raw, true);
if (!is_array($json)) respond(false, ['entries' => []], 'invalid huji json');

respond(true, [
    'entries' => flatten_entries($json['dataValues'] ?? []),
    'source' => 'huji_free',
    'source_url' => $url
]);

