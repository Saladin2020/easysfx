extends Node
## Typing blips for an Easy Dialogue DialogueBox (addons/easydialogue/dialogue_box.tscn).
##
## Add this node next to (or under) the dialogue box, point `dialogue_box` at it and map speakers to
## Easy SFX voice sounds. While the box types a line, every `every`-th visible grapheme cluster plays
## SfxBank.blip(voice) (autoload at /root/SfxBank). Spaces and punctuation are skipped. No changes to Easy Dialogue are needed:
## it reads the box's `state`, `current_line` and typewriter progress.
##
##   voices = {"kid": "blip_kid", "vendor": "blip_auntie"}   # character id (or display name) -> sound id

signal blipped(voice: String, cluster: String)

@export var dialogue_box: NodePath
@export var voices: Dictionary = {}
@export var default_voice := "blip_mid"
## Narration (no speaker) blips too when true.
@export var narration := false
@export var every := 2
@export var volume_db := -6.0

var _box: Node
var _last := 0
var _line_key := ""


func _ready() -> void:
	_box = get_node_or_null(dialogue_box)


func voice_for(line: Dictionary) -> String:
	var speaker := str(line.get("speaker", ""))
	if speaker == "":
		return default_voice if narration else ""
	if voices.has(speaker):
		return voices[speaker]
	var shown_name := str(line.get("name", ""))
	if voices.has(shown_name):
		return voices[shown_name]
	return default_voice


func _process(_delta: float) -> void:
	if _box == null or _box.get("state") != "typing":
		return
	var line = _box.get("current_line")
	if typeof(line) != TYPE_DICTIONARY:
		return
	var key := str(line.get("id", "")) + str(line.get("text", ""))
	if key != _line_key:
		_line_key = key
		_last = 0
	var shown := int(_box.get("_revealed"))
	if shown <= _last:
		return
	var text := str(line.get("text", ""))
	var steps := shown - _last
	_last = shown
	var voice := voice_for(line)
	var bank = get_node_or_null("/root/SfxBank")
	if voice == "" or bank == null or not bank.has_sound(voice):
		return
	# play at most one blip per frame, only on every Nth cluster, never on blanks / punctuation
	if shown % maxi(1, every) != 0 and steps < every:
		return
	var ch := text.substr(clampi(shown - 1, 0, maxi(0, text.length() - 1)), 1)
	if ch.strip_edges() == "" or ".,!?…—-\"'()".contains(ch):
		return
	bank.blip(voice, volume_db)
	blipped.emit(voice, ch)
