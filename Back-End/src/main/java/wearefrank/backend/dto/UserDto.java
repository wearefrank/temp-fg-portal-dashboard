package wearefrank.backend.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record UserDto(
        String name,
        List<String> roles,
        List<String> groups
) {}
