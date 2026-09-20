package brownie_todo_contract

#TodoQueue: {
	todos: [...#TodoContract]
}

#TodoContract: {
	id:                    string
	first_line:            string
	target_paths:          [...string]
	verification_commands: [...string]
	forbidden_sections:    [...string]
	required_sections:     [...string]
	conflicts:             [] | *[]
}

#Conflict: {
	section:              string
	verification_command: string
	forbidden_line:       string
}
