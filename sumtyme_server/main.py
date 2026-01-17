from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any, Optional, Union
import pandas as pd
import uvicorn
from datetime import datetime
import logging
import traceback
import inspect

# Import sumtyme EIPClient
try:
    from sumtyme import EIPClient
    SUMTYME_AVAILABLE = True
    print("Sumtyme package loaded successfully")
except ImportError as e:
    print(f"Warning: sumtyme package not found. Error: {e}")
    print("Please install with: pip install sumtyme")
    SUMTYME_AVAILABLE = False

app = FastAPI(
    title="Sumtyme API Wrapper", 
    version="2.0.0",
    docs_url="/api/docs",       # <--- ADD THIS
    openapi_url="/api/openapi.json" # <--- ADD THIS
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global EIP client
eip_client = None

def initialize_client():
    global eip_client
    if SUMTYME_AVAILABLE and eip_client is None:
        try:
            # Initialize client with API key
            print(inspect.signature(EIPClient))
            eip_client = EIPClient(apikey='stai-pFfEN6MmntY5QqoPjK6vQhwCiJgw-kjDL67TDNUGbAnf')
            logger.info("EIP Client initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize EIP Client: {e}")
            logger.error(traceback.format_exc())
    return eip_client

# Pydantic models for OHLC forecast
class OHLCData(BaseModel):
    datetime: str
    open: float
    high: float
    low: float
    close: float

class OHLCForecastRequest(BaseModel):
    data_input: List[OHLCData]
    interval: int
    interval_unit: str
    reasoning_mode: str

class OHLCForecastResponse(BaseModel):
    causal_chain: int  # Changed from directional_change_forecast to causal_chain (-1, 0, or 1)
    timestamp: str
    processing_time_ms: Optional[float] = None
    data_periods: Optional[int] = None

# Pydantic models for univariate forecast
class UnivariateData(BaseModel):
    datetime: str
    value: float

class UnivariateForecastRequest(BaseModel):
    data_input: List[UnivariateData]
    interval: int
    interval_unit: str
    reasoning_mode: str

class UnivariateForecastResponse(BaseModel):
    causal_chain: int  # -1, 0, or 1
    timestamp: str
    processing_time_ms: Optional[float] = None
    data_periods: Optional[int] = None

# Pydantic models for propagation tracking
class PropagationCheckRequest(BaseModel):
    current_tf_data: List[Dict[str, Any]]  # Output from current timeframe
    next_tf_data: List[Dict[str, Any]]     # Output from next timeframe

class PropagationCheckResponse(BaseModel):
    has_propagated: bool
    propagation_datetime: Optional[str] = None
    chain_value: Optional[int] = None
    timestamp: str

# Legacy signup model (if still needed)
class SignupRequest(BaseModel):
    name: str
    email: str
    phone: str

def convert_ohlc_to_dataframe(ohlc_data: List[OHLCData]) -> pd.DataFrame:
    """Convert OHLC data to pandas DataFrame"""
    data = [{
        'datetime': item.datetime,
        'open': item.open,
        'high': item.high,
        'low': item.low,
        'close': item.close
    } for item in ohlc_data]
    
    df = pd.DataFrame(data)
    df['datetime'] = pd.to_datetime(df['datetime'])
    
    # Validate numeric columns
    for col in ['open', 'high', 'low', 'close']:
        df[col] = pd.to_numeric(df[col], errors='coerce')
    
    # Check for NaN values
    if df[['open', 'high', 'low', 'close']].isna().any().any():
        logger.warning("Found NaN values in OHLC data after conversion")
    
    logger.info(f"Converted {len(df)} OHLC records to DataFrame")
    return df

def convert_univariate_to_dataframe(univariate_data: List[UnivariateData]) -> pd.DataFrame:
    """Convert univariate data to pandas DataFrame"""
    data = [{
        'datetime': item.datetime,
        'value': item.value
    } for item in univariate_data]
    
    df = pd.DataFrame(data)
    df['datetime'] = pd.to_datetime(df['datetime'])
    df['value'] = pd.to_numeric(df['value'], errors='coerce')
    
    logger.info(f"Converted {len(df)} univariate records to DataFrame")
    return df

def validate_data_length(df: pd.DataFrame, min_length: int = 5001) -> pd.DataFrame:
    """
    Validate that DataFrame has at least the minimum number of periods.
    If more than needed, return the latest min_length periods.
    """
    if len(df) < min_length:
        raise ValueError(
            f"Insufficient data: {len(df)} periods. Need at least {min_length} periods "
            f"(5000 historical + 1 forecast placeholder with zeros)."
        )
    
    if len(df) > min_length:
        logger.info(f"Trimming data from {len(df)} to {min_length} periods (keeping latest)")
        return df.iloc[-min_length:].reset_index(drop=True)
    
    return df

@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy", 
        "timestamp": datetime.now().isoformat(),
        "sumtyme_available": SUMTYME_AVAILABLE,
        "client_initialized": eip_client is not None,
        "api_version": "2.0.0"
    }

@app.post("/api/forecast/ohlc", response_model=OHLCForecastResponse)
async def forecast_ohlc(request: OHLCForecastRequest):
    """
    OHLC forecast endpoint using the new ohlc_forecast function.
    Requires exactly 5001 data periods (5000 historical + 1 forecast placeholder).
    """
    if not SUMTYME_AVAILABLE:
        raise HTTPException(status_code=503, detail="Sumtyme package not available")

    client = initialize_client()
    if client is None:
        raise HTTPException(status_code=503, detail="EIP Client not initialized")

    try:
        start_time = datetime.now()

        logger.info(
            f"Received OHLC forecast request: {len(request.data_input)} data points, "
            f"{request.interval} {request.interval_unit}, "
            f"reasoning_mode: {request.reasoning_mode}"
        )

        # Convert to DataFrame
        df = convert_ohlc_to_dataframe(request.data_input)

        # Validate data length
        try:
            df = validate_data_length(df, 5001)
        except ValueError as e:
            logger.error(f"Data validation failed: {e}")
            raise HTTPException(status_code=400, detail=str(e))

        logger.info(f"DataFrame last rows:\n{df.tail()}")
        logger.info(f"DataFrame shape: {df.shape}")
        logger.info(f"DataFrame columns: {df.columns.tolist()}")
        
        df['datetime'] = df['datetime'].dt.strftime('%Y-%m-%d %H:%M:%S')

        # Call sumtyme ohlc_forecast function
        try:
            logger.info("Calling client.ohlc_forecast()...")
            result = client.ohlc_forecast(
                data_input=df,
                interval=request.interval,
                interval_unit=request.interval_unit,
                reasoning_mode=request.reasoning_mode
            )
            logger.info(f"client.ohlc_forecast() returned type: {type(result)}")
            logger.info(f"Raw result: {result}")
        except Exception as e:
            logger.error(f"ohlc_forecast call failed: {e}")
            logger.error(traceback.format_exc())
            raise HTTPException(
                status_code=500,
                detail=f"Sumtyme API call failed: {str(e)}"
            )

        processing_time = (datetime.now() - start_time).total_seconds() * 1000

        # ✅ Extract causal_chain and timestamp directly from the single-entry dictionary
        if not isinstance(result, dict) or len(result) != 1:
            raise HTTPException(status_code=500, detail="Unexpected API response format. Expected single-entry dictionary.")

        timestamp_to_save, causal_chain_value = next(iter(result.items()))
        causal_chain_value = int(causal_chain_value)

        logger.info(
            f"OHLC forecast completed in {processing_time:.2f}ms, "
            f"timestamp: {timestamp_to_save}, causal_chain: {causal_chain_value}"
        )

        return OHLCForecastResponse(
            causal_chain=causal_chain_value,
            timestamp=str(timestamp_to_save),
            processing_time_ms=processing_time,
            data_periods=len(df)
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"OHLC forecast failed: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"OHLC forecast failed: {str(e)}")

@app.post("/api/forecast/univariate", response_model=UnivariateForecastResponse)
async def forecast_univariate(request: UnivariateForecastRequest):
    """
    Univariate forecast endpoint using the new univariate_forecast function.
    Requires exactly 5001 data periods (5000 historical + 1 forecast placeholder).
    """
    if not SUMTYME_AVAILABLE:
        raise HTTPException(status_code=503, detail="Sumtyme package not available")
    
    client = initialize_client()
    if client is None:
        raise HTTPException(status_code=503, detail="EIP Client not initialized")
    
    try:
        start_time = datetime.now()
        df = convert_univariate_to_dataframe(request.data_input)
        
        # Validate data length
        try:
            df = validate_data_length(df, 5001)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        
        logger.info(
            f"Processing univariate forecast for {len(df)} data points, "
            f"{request.interval} {request.interval_unit}, "
            f"reasoning_mode: {request.reasoning_mode}"
        )

        df['datetime'] = df['datetime'].dt.strftime('%Y-%m-%d %H:%M:%S')

        # Call sumtyme univariate_forecast function
        result = client.univariate_forecast(
            data_input=df,
            interval=request.interval,
            interval_unit=request.interval_unit,
            reasoning_mode=request.reasoning_mode
        )
        
        processing_time = (datetime.now() - start_time).total_seconds() * 1000
        
        # Extract causal_chain value from result
        causal_chain_value = 0
        
        if isinstance(result, pd.DataFrame) and 'causal_chain' in result.columns:
            causal_chain_value = int(result['causal_chain'].iloc[-1])
        elif isinstance(result, (int, float)):
            causal_chain_value = int(result)
        elif isinstance(result, dict) and 'causal_chain' in result:
            causal_chain_value = int(result['causal_chain'])
        else:
            logger.warning(f"Unexpected result format: {type(result)}")
            causal_chain_value = 0
        
        logger.info(
            f"Univariate forecast completed in {processing_time:.2f}ms, "
            f"causal_chain: {causal_chain_value}"
        )
        
        return UnivariateForecastResponse(
            causal_chain=causal_chain_value,
            timestamp=datetime.now().isoformat(),
            processing_time_ms=processing_time,
            data_periods=len(df)
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Univariate forecast failed: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Univariate forecast failed: {str(e)}")

@app.post("/api/analysis/propagation", response_model=PropagationCheckResponse)
async def check_propagation(request: PropagationCheckRequest):
    """
    Check if a causal chain has propagated from one timeframe to the next.
    Uses the new check_chain_propagation function.
    """
    if not SUMTYME_AVAILABLE:
        raise HTTPException(status_code=503, detail="Sumtyme package not available")
    
    client = initialize_client()
    if client is None:
        raise HTTPException(status_code=503, detail="EIP Client not initialized")
    
    try:
        # Convert input data to DataFrames
        current_tf_df = pd.DataFrame(request.current_tf_data)
        next_tf_df = pd.DataFrame(request.next_tf_data)
        
        logger.info(
            f"Checking propagation between timeframes: "
            f"{len(current_tf_df)} -> {len(next_tf_df)} periods"
        )
        
        # Call sumtyme propagation tracker
        has_propagated, propagation_datetime, chain_value = client.check_chain_propagation(
            current_tf=current_tf_df,
            next_tf=next_tf_df
        )
        
        logger.info(
            f"Propagation check: {has_propagated}, "
            f"datetime: {propagation_datetime}, "
            f"chain_value: {chain_value}"
        )
        
        return PropagationCheckResponse(
            has_propagated=has_propagated,
            propagation_datetime=propagation_datetime.isoformat() if propagation_datetime else None,
            chain_value=chain_value,
            timestamp=datetime.now().isoformat()
        )
    
    except Exception as e:
        logger.error(f"Propagation check failed: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Propagation check failed: {str(e)}")

# Legacy endpoint for backward compatibility
@app.post("/api/predict/directional_change")
async def predict_directional_change_legacy(request: OHLCForecastRequest):
    """
    Legacy endpoint - redirects to new ohlc_forecast endpoint.
    Deprecated: Use /forecast/ohlc instead.
    """
    logger.warning("Legacy endpoint /predict/directional_change called. Use /forecast/ohlc instead.")
    
    try:
        # Call the new endpoint
        result = await forecast_ohlc(request)
        
        # Convert to legacy format
        return {
            "directional_change_forecast": result.causal_chain > 0,
            "confidence": abs(result.causal_chain) * 100,  # Convert to percentage
            "timestamp": result.timestamp,
            "causal_chain": result.causal_chain,  # Include new field
            "processing_time_ms": result.processing_time_ms,
            "deprecation_warning": "This endpoint is deprecated. Use /forecast/ohlc instead."
        }
    except Exception as e:
        logger.error(f"Legacy endpoint failed: {e}")
        raise

@app.post("/api/signup")
async def signup_user(request: SignupRequest):
    """
    User signup endpoint (if still supported by sumtyme).
    Check latest documentation for current signup process.
    """
    if not SUMTYME_AVAILABLE:
        raise HTTPException(status_code=503, detail="Sumtyme package not available")
    
    try:
        # Note: Check if this method still exists in the latest sumtyme version
        client = EIPClient(apikey='temp')
        result = client.user_signup(payload={
            "email": request.email,
            "password": "min_password_length_8",
            "confirm_password": "min_password_length_8"
        })
        
        return {
            "success": True,
            "message": "Signup successful! Check config.txt for API key. Email team@sumtyme.ai for activation.",
            "result": result
        }
    except Exception as e:
        logger.error(f"Signup failed: {e}")
        raise HTTPException(status_code=500, detail=f"Signup failed: {str(e)}")

@app.on_event("startup")
async def startup_event():
    logger.info("Starting Sumtyme API Wrapper v2.0.0")
    initialize_client()
    logger.info("Server initialization complete")

@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Shutting down Sumtyme API Wrapper")

if __name__ == "__main__":
    print("=" * 60)
    print("Starting Sumtyme API Wrapper v2.0.0")
    print("=" * 60)
    print(f"Sumtyme package available: {SUMTYME_AVAILABLE}")
    print("\nEndpoints:")
    print("  - POST /forecast/ohlc (NEW)")
    print("  - POST /forecast/univariate (NEW)")
    print("  - POST /analysis/propagation (NEW)")
    print("  - POST /predict/directional_change (LEGACY - Deprecated)")
    print("  - GET /health")
    print("=" * 60)
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
