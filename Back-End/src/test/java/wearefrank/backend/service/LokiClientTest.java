package wearefrank.backend.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.io.IOException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class LokiClientTest {

    @Mock
    HttpClient httpClient;

    @SuppressWarnings("unchecked")
    @Mock
    HttpResponse<String> httpResponse;

    LokiClient lokiClient;

    @BeforeEach
    void setUp() {
        lokiClient = new LokiClient("http://localhost:3100", "", httpClient);
    }

    @Test
    void queryRange_returnsBody_on200() throws Exception {
        doReturn(httpResponse).when(httpClient).send(any(), any());
        when(httpResponse.statusCode()).thenReturn(200);
        when(httpResponse.body()).thenReturn("{\"status\":\"success\"}");

        String result = lokiClient.queryRange("{app_name=\"apisix\"}", 1000L, 2000L, 100, "backward");

        assertThat(result).isEqualTo("{\"status\":\"success\"}");
    }

    @Test
    void queryRange_throwsRuntimeException_onNon200() throws Exception {
        doReturn(httpResponse).when(httpClient).send(any(), any());
        when(httpResponse.statusCode()).thenReturn(503);

        assertThatThrownBy(() -> lokiClient.queryRange("{app_name=\"apisix\"}", 1000L, 2000L, 100, "backward"))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("503");
    }

    @Test
    void queryRange_throwsRuntimeException_onNetworkException() throws Exception {
        doThrow(new IOException("connection refused")).when(httpClient).send(any(), any());

        assertThatThrownBy(() -> lokiClient.queryRange("{app_name=\"apisix\"}", 1000L, 2000L, 100, "backward"))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("Failed to reach Loki");
    }

    @Test
    void queryRange_urlEncodesLogQL() throws Exception {
        ArgumentCaptor<HttpRequest> captor = ArgumentCaptor.forClass(HttpRequest.class);
        doReturn(httpResponse).when(httpClient).send(captor.capture(), any());
        when(httpResponse.statusCode()).thenReturn(200);
        when(httpResponse.body()).thenReturn("result");

        lokiClient.queryRange("{app_name=\"apisix\"}", 1000L, 2000L, 100, "backward");

        assertThat(captor.getValue().uri().toString())
                .contains("query=%7Bapp_name%3D%22apisix%22%7D")
                .startsWith("http://localhost:3100/loki/api/v1/query_range");
    }

    @Test
    void queryRange_passesNanosecondBoundsThroughUnchanged() throws Exception {
        ArgumentCaptor<HttpRequest> captor = ArgumentCaptor.forClass(HttpRequest.class);
        doReturn(httpResponse).when(httpClient).send(captor.capture(), any());
        when(httpResponse.statusCode()).thenReturn(200);
        when(httpResponse.body()).thenReturn("result");

        // nanoseconds now arrive already converted, and must be passed through exactly -
        // rounding here is what would make paging re-serve or skip lines
        lokiClient.queryRange("{app_name=\"apisix\"}", 1700000000000000000L, 1700003600123456789L, 50, "backward");

        String uri = captor.getValue().uri().toString();
        assertThat(uri).contains("start=1700000000000000000");
        assertThat(uri).contains("end=1700003600123456789");
        assertThat(uri).contains("limit=50");
        assertThat(uri).contains("direction=backward");
    }

    @Test
    void queryRange_omitsTenantHeader_whenTenantIdBlank() throws Exception {
        ArgumentCaptor<HttpRequest> captor = ArgumentCaptor.forClass(HttpRequest.class);
        doReturn(httpResponse).when(httpClient).send(captor.capture(), any());
        when(httpResponse.statusCode()).thenReturn(200);
        when(httpResponse.body()).thenReturn("result");

        lokiClient.queryRange("{app_name=\"apisix\"}", 1000L, 2000L, 100, "backward");

        assertThat(captor.getValue().headers().firstValue("X-Scope-OrgID")).isEmpty();
    }

    @Test
    void queryRange_sendsTenantHeader_whenTenantIdSet() throws Exception {
        lokiClient = new LokiClient("http://localhost:3100", "local", httpClient);
        ArgumentCaptor<HttpRequest> captor = ArgumentCaptor.forClass(HttpRequest.class);
        doReturn(httpResponse).when(httpClient).send(captor.capture(), any());
        when(httpResponse.statusCode()).thenReturn(200);
        when(httpResponse.body()).thenReturn("result");

        lokiClient.queryRange("{app_name=\"apisix\"}", 1000L, 2000L, 100, "backward");

        assertThat(captor.getValue().headers().firstValue("X-Scope-OrgID")).contains("local");
    }
}
