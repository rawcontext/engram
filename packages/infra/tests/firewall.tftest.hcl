# Firewall configuration tests

variables {
  hcloud_token = "test-token"
}

run "firewall_has_required_rules" {
  command = plan

  assert {
    condition     = length(hcloud_firewall.engram.rule) >= 7
    error_message = "Firewall should have at least 7 rules (SSH, HTTP, HTTPS, API, Search, Tuner, ICMP)"
  }
}

run "firewall_has_ssh_rule" {
  command = plan

  assert {
    condition = anytrue([
      for rule in hcloud_firewall.engram.rule :
      rule.port == "22" && rule.protocol == "tcp" && rule.direction == "in"
    ])
    error_message = "SSH port 22 should be open"
  }
}

run "firewall_has_http_rule" {
  command = plan

  assert {
    condition = anytrue([
      for rule in hcloud_firewall.engram.rule :
      rule.port == "80" && rule.protocol == "tcp" && rule.direction == "in"
    ])
    error_message = "HTTP port 80 should be open"
  }
}

run "firewall_has_https_rule" {
  command = plan

  assert {
    condition = anytrue([
      for rule in hcloud_firewall.engram.rule :
      rule.port == "443" && rule.protocol == "tcp" && rule.direction == "in"
    ])
    error_message = "HTTPS port 443 should be open"
  }
}

run "firewall_has_api_rule" {
  command = plan

  assert {
    condition = anytrue([
      for rule in hcloud_firewall.engram.rule :
      rule.port == "8080" && rule.protocol == "tcp" && rule.direction == "in"
    ])
    error_message = "API port 8080 should be open"
  }
}

run "firewall_has_search_rule" {
  command = plan

  assert {
    condition = anytrue([
      for rule in hcloud_firewall.engram.rule :
      rule.port == "5002" && rule.protocol == "tcp" && rule.direction == "in"
    ])
    error_message = "Search port 5002 should be open"
  }
}

run "firewall_has_tuner_rule" {
  command = plan

  assert {
    condition = anytrue([
      for rule in hcloud_firewall.engram.rule :
      rule.port == "8000" && rule.protocol == "tcp" && rule.direction == "in"
    ])
    error_message = "Tuner port 8000 should be open"
  }
}
