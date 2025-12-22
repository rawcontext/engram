# Server configuration tests

variables {
  hcloud_token = "test-token"
}

# Test that server configuration is valid
run "server_config_valid" {
  command = plan

  assert {
    condition     = hcloud_server.engram.server_type == "cpx31"
    error_message = "Server type should be cpx31"
  }

  assert {
    condition     = hcloud_server.engram.location == "ash"
    error_message = "Server should be in Ashburn, VA (ash)"
  }

  assert {
    condition     = hcloud_server.engram.image == "ubuntu-24.04"
    error_message = "Server should use Ubuntu 24.04"
  }

  assert {
    condition     = hcloud_server.engram.name == "engram"
    error_message = "Server name should be 'engram'"
  }
}

# Test server type override
run "server_type_override" {
  command = plan

  variables {
    server_type = "cpx21"
  }

  assert {
    condition     = hcloud_server.engram.server_type == "cpx21"
    error_message = "Server type override should work"
  }
}

# Test location override
run "location_override" {
  command = plan

  variables {
    location = "nbg1"
  }

  assert {
    condition     = hcloud_server.engram.location == "nbg1"
    error_message = "Location override should work"
  }
}
