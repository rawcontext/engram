# SSH key configuration tests

variables {
  hcloud_token = "test-token"
}

run "ssh_key_config_valid" {
  command = plan

  assert {
    condition     = hcloud_ssh_key.engram.name == "engram-key"
    error_message = "SSH key name should be 'engram-key'"
  }
}

run "ssh_key_name_override" {
  command = plan

  variables {
    ssh_key_name = "custom-key"
  }

  assert {
    condition     = hcloud_ssh_key.engram.name == "custom-key"
    error_message = "SSH key name override should work"
  }
}
